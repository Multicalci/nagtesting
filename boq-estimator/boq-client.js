/* boq-client.js — talks ONLY to /api/boq. The client never receives schemas,
 * rates, formulas, multiplier tables or compliance expressions — only the
 * render-only form projection and computed results. */
(function () {
  "use strict";
  const API = "/api/boq";
  const REGIONS = ["USA","India","Middle East (GCC)","UK","Europe","China","Japan","ASEAN"];
  const $ = id => document.getElementById(id);
  let current = null, tier = 1;

  async function api(payload) {
    const r = await fetch(API, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload) });
    if (r.status === 429) throw new Error("Too many requests — please wait a moment.");
    return r.json();
  }

  // ---- streams dropdown
  api({ action: "streams" }).then(d => {
    (d.streams || []).forEach(s => {
      const o = document.createElement("option"); o.value = s; o.textContent = s;
      $("stream").appendChild(o);
    });
  }).catch(() => {});

  // ---- region dropdown
  REGIONS.forEach(r => {
    const o = document.createElement("option"); o.value = r; o.textContent = "Project region: " + r;
    $("region").appendChild(o);
  });

  // ---- search
  async function search() {
    const q = $("q").value.trim();
    const hits = $("hits");
    if (q.length < 3) { hits.innerHTML = '<div class="note">Type at least 3 characters.</div>'; return; }
    hits.innerHTML = '<span class="spin"></span>';
    try {
      const d = await api({ action: "search", q, stream: $("stream").value || undefined });
      if (d.error) { hits.innerHTML = `<div class="note">${esc(d.error)}</div>`; return; }
      if (!d.results.length) { hits.innerHTML = '<div class="note">No matches — try different keywords.</div>'; return; }
      hits.innerHTML = "";
      d.results.forEach(h => {
        const div = document.createElement("div");
        div.className = "hit";
        div.innerHTML = `<span>${esc(h.item)}</span><span class="s">${esc(h.stream)}</span>`;
        div.onclick = () => loadForm(h.schema_id, h.item);
        hits.appendChild(div);
      });
      if (d.capped) hits.insertAdjacentHTML("beforeend",
        '<div class="note">Showing top 12 — refine your search for a closer match.</div>');
    } catch (e) { hits.innerHTML = `<div class="note">${esc(e.message)}</div>`; }
  }
  $("btnSearch").onclick = search;
  $("q").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); search(); } });

  // ---- form
  async function loadForm(sid, itemName) {
    const d = await api({ action: "form", schema_id: sid });
    if (d.error) return alert(d.error);
    current = d; current.pickedItem = itemName;
    $("fTitle").textContent = d.name;
    $("fMeta").textContent = `${d.stream} · selected item: ${itemName} · ${d.tier_note || ""}`;
    renderFields();
    $("formCard").classList.remove("hide");
    $("resultCard").classList.add("hide");
    $("formCard").scrollIntoView({ behavior: "smooth" });
  }

  function renderFields() {
    const form = $("boqForm"); form.innerHTML = "";
    const bySection = {};
    current.fields.filter(f => (f.tier || 1) <= tier).forEach(f => {
      (bySection[f.section] = bySection[f.section] || []).push(f);
    });
    for (const [sec, fields] of Object.entries(bySection)) {
      const fs = document.createElement("fieldset");
      fs.innerHTML = `<legend>${esc(sec)}</legend>`;
      fields.forEach(f => {
        const w = document.createElement("div"); w.className = "f";
        const u = f.unit ? ` <span class="u">(${esc(f.unit)})</span>` : "";
        const req = f.mandatory ? ' <span class="req">*</span>' : "";
        w.innerHTML = `<label for="${f.field_id}"><b>${esc(f.label)}</b>${u}${req}</label>`;
        let el;
        if (f.type === "dropdown") {
          el = document.createElement("select");
          el.innerHTML = '<option value="">— select —</option>' +
            (f.options || []).map(o => `<option>${esc(String(o))}</option>`).join("");
          if (f.spec_key === "equipment_subtype" || f.spec_key === "activity_subtype") el.value = current.pickedItem;
        } else {
          el = document.createElement("input");
          el.type = f.type === "number" ? "number" : "text";
          el.step = "any";
        }
        el.id = f.field_id; el.dataset.spec = f.spec_key;
        if (f.mandatory) el.required = true;
        w.appendChild(el); fs.appendChild(w);
      });
      form.appendChild(fs);
    }
  }

  document.querySelectorAll("#tiers button").forEach(b => b.onclick = () => {
    tier = +b.dataset.t;
    document.querySelectorAll("#tiers button").forEach(x => x.classList.toggle("on", x === b));
    if (current) renderFields();
  });

  // ---- calc
  $("btnCalc").onclick = async () => {
    if (!current) return;
    const inputs = {};
    let ok = true;
    document.querySelectorAll("#boqForm [data-spec]").forEach(el => {
      if (el.required && !el.value) { el.style.borderColor = "#b0322a"; ok = false; }
      else el.style.borderColor = "";
      if (el.value !== "") inputs[el.dataset.spec] = el.value;
    });
    if (!inputs.equipment_subtype && !inputs.activity_subtype) inputs.equipment_subtype = current.pickedItem;
    if (!ok) return;
    const btn = $("btnCalc"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Calculating…';
    try {
      const d = await api({ action: "calc", schema_id: current.schema_id, tier,
        region: $("region").value, inputs });
      btn.disabled = false; btn.textContent = "Calculate Estimate";
      if (d.error) return alert(d.error);
      const fmt = n => "US$ " + Number(n).toLocaleString("en-US");
      $("rTotal").textContent = fmt(d.total);
      $("rRange").textContent = `Expected range: ${fmt(d.range_low)} – ${fmt(d.range_high)}`;
      $("rConf").textContent = d.confidence;
      $("rMeta").textContent = `${d.item} · qty ${d.quantity} · basis ${d.unit_basis} · region ${d.region}` +
        (d.applied_factors.length ? ` · adjustments applied: ${d.applied_factors.join(", ")}` : "");
      const badge = $("basisBadge");
      const bench = (d.estimate_basis || "").startsWith("benchmark");
      badge.className = "badge " + (bench ? "bench" : "cal");
      badge.textContent = bench ? "Benchmark estimate" : "Calibrated rate";
      $("rAlerts").innerHTML = (d.alerts || []).map(a =>
        `<div class="alert ${esc(a.severity)}">${a.severity === "error" ? "⚠️" : a.severity === "warning" ? "⚠" : "ℹ"} ${esc(a.message)}</div>`).join("");
      $("resultCard").classList.remove("hide");
      $("resultCard").scrollIntoView({ behavior: "smooth" });
    } catch (e) { btn.disabled = false; btn.textContent = "Calculate Estimate"; alert(e.message); }
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
})();
