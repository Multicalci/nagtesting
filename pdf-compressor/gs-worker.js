// gs-worker.js
// Runs Ghostscript-WASM inside a dedicated Web Worker so the main thread
// (and page UI) never freezes during compression.
//
// IMPORTANT: this must be loaded as a module worker:
//   new Worker("gs-worker.js", { type: "module" })
// The gs.js (CommonJS/global) build does not reliably expose gs.FS/gs.callMain
// inside workers. The ES module entrypoint (gs.mjs) with its default-exported
// initGhostscript() is the entry point that actually works.
//
// Package: @jspawn/ghostscript-wasm (AGPL-3.0), loaded unmodified from CDN.
// https://github.com/jsscheller/ghostscript-wasm

const GS_CDN_BASE = "https://cdn.jsdelivr.net/npm/@jspawn/ghostscript-wasm@0.0.2/";

let gsInstancePromise = null;

function loadGhostscript() {
  if (gsInstancePromise) return gsInstancePromise;

  gsInstancePromise = (async () => {
    const mod = await import(/* webpackIgnore: true */ GS_CDN_BASE + "gs.mjs");
    const initGhostscript = mod.default;

    const gs = await initGhostscript({
      locateFile: (file) => GS_CDN_BASE + file,
      print: () => {},
      printErr: (msg) => self.postMessage({ type: "log", message: msg }),
    });

    return gs;
  })();

  return gsInstancePromise;
}

// Maps a simple UI-facing quality level to Ghostscript's built-in PDFSETTINGS.
const PRESETS = {
  low: "/screen", // ~72dpi images, most aggressive
  medium: "/ebook", // ~150dpi images, good default
  high: "/prepress", // ~300dpi images, near-original quality
};

self.onmessage = async (e) => {
  const { fileBuffer, fileName, quality } = e.data;

  // Safety net: if nothing has reported back within 3 minutes, something is
  // stuck (bad CDN response, unexpected build change, etc). Report an error
  // instead of leaving the UI spinning forever.
  const hangTimeout = setTimeout(() => {
    self.postMessage({
      type: "error",
      message:
        "Compression timed out. This may be a temporary CDN issue — please try again. If it keeps happening, the file may be too large for this device.",
    });
  }, 3 * 60 * 1000);

  try {
    self.postMessage({ type: "status", message: "Loading compression engine…" });
    const gs = await loadGhostscript();

    const inputName = "input.pdf";
    const outputName = "output.pdf";
    const preset = PRESETS[quality] || PRESETS.medium;

    gs.FS.writeFile(inputName, new Uint8Array(fileBuffer));

    self.postMessage({ type: "status", message: "Compressing…" });

    const args = [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      `-dPDFSETTINGS=${preset}`,
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      "-dDownsampleColorImages=true",
      "-dDownsampleGrayImages=true",
      "-dDownsampleMonoImages=true",
      `-sOutputFile=${outputName}`,
      inputName,
    ];

    gs.callMain(args);

    const output = gs.FS.readFile(outputName);

    try {
      gs.FS.unlink(inputName);
      gs.FS.unlink(outputName);
    } catch (_) {
      /* non-fatal */
    }

    clearTimeout(hangTimeout);
    self.postMessage(
      {
        type: "done",
        fileName,
        buffer: output.buffer,
      },
      [output.buffer]
    );
  } catch (err) {
    clearTimeout(hangTimeout);
    const message =
      err && /memory/i.test(String(err.message || err))
        ? "Out of memory. This file is too large or your device has too little available RAM to compress it in the browser. Try a smaller file or lower quality setting."
        : "Compression failed: " + (err && err.message ? err.message : String(err));
    self.postMessage({ type: "error", message });
  }
};

// Catch anything that escapes the try/catch above (e.g. a load-time error
// thrown before onmessage's own handler is reachable, or an unhandled
// rejection from a stray promise).
self.addEventListener("error", (e) => {
  self.postMessage({ type: "error", message: "Worker error: " + e.message });
});
self.addEventListener("unhandledrejection", (e) => {
  self.postMessage({
    type: "error",
    message: "Worker error: " + (e.reason && e.reason.message ? e.reason.message : String(e.reason)),
  });
});
