const state = {
  works: [],
  workTags: [],
  metadata: [],
  worksById: new Map(),
  metaByTag: new Map(),
  tagsByWork: new Map(),
  frequencyByTag: new Map(),
  selectedCategories: new Set(),
  minFrequency: 1,
  minWeight: 1,
  excludedTags: new Set(),
  compareTags: new Set(),
  worksTags: new Set(),
  worksMatchMode: "all",
  // Pinned node positions, kept separately for each lens + view mode so a pin
  // made in one layout does not distort another (keys like "tag:full").
  pinsByMode: {},
  // "tag" = hashtag-based network (Network / Compare / Find works)
  // "work" = work-based network (Network / Compare)
  lens: "tag",
  viewMode: "full",
  // Work lens
  minJaccard: 0.2,
  includeRomance: false,
  highlightTags: new Map(), // tag -> colour, in the order they were picked
  compareWorks: new Set(),
  worksListVisible: true,
  currentGraph: null
};

const svg = d3.select("#network");
const graphLayer = svg.append("g").attr("class", "graph-layer");

svg.call(
  d3.zoom()
    .scaleExtent([0.2, 5])
    .on("zoom", (event) => {
      graphLayer.attr("transform", event.transform);
    })
);

Promise.all([
  d3.csv("data/works.csv"),
  d3.csv("data/work_tags.csv"),
  d3.csv("data/tag_metadata.csv")
])
  .then(([works, workTags, metadata]) => {
    state.works = works;
    state.workTags = workTags;
    state.metadata = metadata;

    prepareData();
    renderDataOverview();
    // Initialize the two independent tag selectors first. A failure in an
    // unrelated panel must not leave Matching Works with empty dropdowns.
    setupWorksControls();
    setupControls();
    setupHelpModal();
    setupWorkLensControls();
    setupMagnifier();
    setupModeSwitch();
    updateNetwork();
  })
  .catch((error) => {
    console.error(error);
    d3.select("#data-status").text("Could not initialize the explorer: " + error.message);
    d3.select("#works-mode-help").text("Dropdowns could not load. Check the Data Status section above.");
  });

// Removes bare text such as "No tags selected." left behind by an earlier
// empty-state message, so it does not sit next to newly drawn chips/items.
function clearPlaceholderText(selection) {
  const el = selection.node();
  if (!el) return;
  Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .forEach((n) => n.remove());
}

function cleanTag(tag) {
  return String(tag || "")
    .trim()
    .replace(/^#/, "");
}

function cleanCategory(category) {
  return String(category || "unknown")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/\//g, "_")
    .toLowerCase();
}

function formatCategory(category) {
  return String(category || "unknown").replace(/_/g, " ");
}

function prepareData() {
  state.worksById = new Map(
    state.works.map((work) => [work.work_id, work])
  );

  state.metadata = state.metadata
    .map((d) => ({
      tag: cleanTag(d.tag),
      category: cleanCategory(d.category),
      description: d.description || ""
    }))
    .filter((d) => d.tag && d.tag !== "N/A");

  state.metaByTag = new Map(
    state.metadata.map((d) => [d.tag, d])
  );

  state.workTags = state.workTags
    .map((d) => ({
      work_id: String(d.work_id || "").trim(),
      tag: cleanTag(d.tag)
    }))
    .filter((d) => d.work_id && d.tag && d.tag !== "N/A");

  state.tagsByWork = new Map();

  for (const row of state.workTags) {
    if (!state.tagsByWork.has(row.work_id)) {
      state.tagsByWork.set(row.work_id, new Set());
    }

    state.tagsByWork.get(row.work_id).add(row.tag);
  }

  state.frequencyByTag = new Map();

  for (const tags of state.tagsByWork.values()) {
    for (const tag of tags) {
      state.frequencyByTag.set(tag, (state.frequencyByTag.get(tag) || 0) + 1);
    }
  }
}

function setupControls() {
  const categories = Array.from(
    new Set(state.metadata.map((d) => d.category))
  ).sort();

  state.selectedCategories = new Set(categories);

  const categoryContainer = d3.select("#category-filters");

  const rows = categoryContainer
    .selectAll("label")
    .data(categories)
    .join("label")
    .attr("class", "checkbox-row");

  rows.each(function (category) {
    const row = d3.select(this);
    row.html("");

    row.append("input")
      .attr("type", "checkbox")
      .property("checked", true)
      .on("change", function () {
        if (this.checked) {
          state.selectedCategories.add(category);
        } else {
          state.selectedCategories.delete(category);
        }

        updateNetwork();
      });

    row.append("span")
      .text(" " + formatCategory(category));
  });

  const maxFrequency = d3.max(Array.from(state.frequencyByTag.values())) || 1;

  d3.select("#min-frequency")
    .attr("max", maxFrequency)
    .on("input", function () {
      state.minFrequency = +this.value;
      d3.select("#frequency-value").text(state.minFrequency);
      updateNetwork();
    });

  d3.select("#min-weight")
    .on("input", function () {
      state.minWeight = +this.value;
      d3.select("#weight-value").text(state.minWeight);
      updateNetwork();
    });

  setupExcludeTagControl();
  setupPinControls();
  setupCompareControls();
}

function currentPins() {
  const key = `${state.lens}:${state.viewMode}`;
  if (!state.pinsByMode[key]) state.pinsByMode[key] = new Map();
  return state.pinsByMode[key];
}

function updatePinStatus() {
  const n = currentPins().size;
  d3.select("#pin-count").text(n ? `${n} pinned node${n > 1 ? "s" : ""}` : "No pinned nodes");
  d3.select("#clear-all-pins").property("disabled", n === 0);
}

function setupPinControls() {
  d3.select("#clear-all-pins").on("click", function () {
    currentPins().clear();
    updateNetwork();
  });
}

function setupExcludeTagControl() {
  const categories = Array.from(
    new Set(state.metadata.map((d) => d.category).filter(Boolean))
  ).sort();

  const categorySelect = d3.select("#hide-category");
  const tagSelect = d3.select("#hide-tag");

  if (categorySelect.empty() || tagSelect.empty()) {
    console.warn("Hide tag controls not found in HTML.");
    return;
  }

  categorySelect
    .selectAll("option")
    .data(categories)
    .join("option")
    .attr("value", (d) => d)
    .text((d) => formatCategory(d));

  categorySelect.on("change", updateHideTagDropdown);

  d3.select("#add-hidden-tag").on("click", function () {
    const tag = tagSelect.property("value");

    if (tag) {
      state.excludedTags.add(tag);
      renderHiddenTagChips();
      updateNetwork();
    }
  });

  d3.select("#clear-hidden-tags").on("click", function () {
    state.excludedTags.clear();
    renderHiddenTagChips();
    updateNetwork();

    d3.select("#inspector").html("All hidden tags have been restored.");
  });

  updateHideTagDropdown();
  renderHiddenTagChips();
}

function updateHideTagDropdown() {
  const selectedCategory = d3.select("#hide-category").property("value");

  const tags = Array.from(state.frequencyByTag.keys())
    .filter((tag) => {
      if (!tag || tag === "N/A") return false;
      if (state.excludedTags.has(tag)) return false;

      const meta = state.metaByTag.get(tag);
      return meta && meta.category === selectedCategory;
    })
    .sort();

  const tagSelect = d3.select("#hide-tag");

  tagSelect
    .selectAll("option")
    .data(tags)
    .join("option")
    .attr("value", (d) => d)
    .text((d) => d);

  if (tags.length === 0) {
    tagSelect
      .selectAll("option")
      .data([""])
      .join("option")
      .attr("value", "")
      .text("No available tags");
  }
}

function renderHiddenTagChips() {
  const tags = Array.from(state.excludedTags).sort();
  const container = d3.select("#hidden-tag-chips");

  if (container.empty()) return;

  if (tags.length === 0) {
    container.html("No hidden tags selected.");
    updateHideTagDropdown();
    return;
  }

  clearPlaceholderText(container);

  const chips = container
    .selectAll(".tag-chip")
    .data(tags, (d) => d)
    .join("span")
    .attr("class", "tag-chip");

  chips.html("");

  chips.append("span").text((d) => d);

  chips.append("button")
    .text("×")
    .on("click", function (event, tag) {
      event.stopPropagation();

      state.excludedTags.delete(tag);
      renderHiddenTagChips();
      updateNetwork();
    });

  updateHideTagDropdown();
}

function setupCompareControls() {
  const categories = Array.from(
    new Set(state.metadata.map((d) => d.category).filter(Boolean))
  ).sort();

  const categorySelect = d3.select("#compare-category");
  const tagSelect = d3.select("#compare-tag");

  if (categorySelect.empty() || tagSelect.empty()) {
    console.warn("Compare controls not found in HTML.");
    return;
  }

  categorySelect
    .selectAll("option")
    .data(categories)
    .join("option")
    .attr("value", (d) => d)
    .text((d) => formatCategory(d));

  categorySelect.on("change", updateCompareTagDropdown);

  d3.select("#add-compare-tag").on("click", function () {
    const tag = tagSelect.property("value");

    if (!tag || state.compareTags.has(tag)) return;

    state.compareTags.add(tag);
    renderCompareChips();
    updateCompareTagDropdown();
    updateNetwork();
  });

  d3.select("#clear-compare-tags").on("click", function () {
    state.compareTags.clear();
    renderCompareChips();
    updateCompareTagDropdown();
    updateNetwork();
  });

  updateCompareTagDropdown();
  renderCompareChips();
}

function updateCompareTagDropdown() {
  const selectedCategory = d3.select("#compare-category").property("value");

  const tags = Array.from(state.frequencyByTag.keys())
    .filter((tag) => {
      const meta = state.metaByTag.get(tag);
      return meta && meta.category === selectedCategory && !state.compareTags.has(tag);
    })
    .sort((a, b) => a.localeCompare(b, "ko"));

  const tagSelect = d3.select("#compare-tag");

  tagSelect
    .selectAll("option")
    .data(tags)
    .join("option")
    .attr("value", (d) => d)
    .text((d) => d);
}

function renderCompareChips() {
  const tags = Array.from(state.compareTags);

  const container = d3.select("#selected-compare-tags");

  if (tags.length === 0) {
    container.html("No comparison tags selected.");
    return;
  }

  clearPlaceholderText(container);

  const chips = container
    .selectAll(".tag-chip")
    .data(tags, (d) => d)
    .join("span")
    .attr("class", "tag-chip");

  chips.html("");

  chips.append("span").text((d) => d);

  chips.append("button")
    .text("×")
    .on("click", function (event, tag) {
      event.stopPropagation();

      state.compareTags.delete(tag);
      renderCompareChips();
      updateCompareTagDropdown();
      updateNetwork();
    });
}

function updateNetwork() {
  const mode = state.viewMode;
  let graph;

  if (state.lens === "work") {
    graph = mode === "comparison" && state.compareWorks.size >= 2
      ? buildWorkComparisonGraph()
      : buildWorkGraph();
  } else {
    graph = mode === "works" && state.worksTags.size
      ? buildWorksGraph()
      : mode === "comparison" && state.compareTags.size >= 2
        ? buildComparisonGraph()
        : buildGraph();
  }

  state.currentGraph = graph;
  drawNetwork(graph);
  updatePinStatus();

  if (state.lens === "tag") {
    updateCompareFilterNote();
    renderWorksList();
    if (mode === "comparison") compareSelectedTags();
  } else {
    renderHighlightChips();
    renderCompareWorksChips();
    if (mode === "comparison") renderWorkCompareResults();
  }

  let hint = "";
  if (state.lens === "tag" && mode === "comparison" && state.compareTags.size < 2) {
    hint = `<span class="status-hint">Add ${2 - state.compareTags.size} more tag(s) to see the comparison layout.</span>`;
  } else if (state.lens === "tag" && mode === "works" && !state.worksTags.size) {
    hint = `<span class="status-hint">Add a tag to see matching works.</span>`;
  } else if (state.lens === "work" && mode === "comparison" && state.compareWorks.size < 2) {
    hint = `<span class="status-hint">Add ${2 - state.compareWorks.size} more work(s) to see the comparison layout.</span>`;
  }

  let counts;
  if (graph.mode === "works" || graph.mode === "worknet") {
    counts = `<strong>${graph.nodes.filter((d) => d.type === "work").length}</strong> works · <strong>${graph.links.length}</strong> links`;
  } else if (graph.mode === "comparison" && graph.lens === "work") {
    counts = `<strong>${graph.compareTags.length}</strong> works · <strong>${graph.nodes.length - graph.compareTags.length}</strong> hashtags`;
  } else {
    counts = `<strong>${graph.nodes.length}</strong> tags · <strong>${graph.links.length}</strong> links`;
  }

  d3.select("#data-status").html(`${counts}${hint ? "<br>" + hint : ""}`);
}

// Filters live in the Network tab; tell Compare users when some are active.
function updateCompareFilterNote() {
  const note = d3.select("#compare-filter-note");
  if (note.empty()) return;
  const allCats = new Set(state.metadata.map((d) => d.category));
  const parts = [];
  const offCats = Array.from(allCats).filter((c) => !state.selectedCategories.has(c));
  if (offCats.length) parts.push(`${offCats.length} categor${offCats.length > 1 ? "ies" : "y"} off`);
  if (state.minFrequency > 1) parts.push(`min frequency ${state.minFrequency}`);
  if (state.minWeight > 1) parts.push(`min edge weight ${state.minWeight}`);
  if (state.excludedTags.size) parts.push(`${state.excludedTags.size} hidden tag${state.excludedTags.size > 1 ? "s" : ""}`);
  note.classed("hidden", !parts.length)
    .text(parts.length ? `Network filters also apply here: ${parts.join(", ")}.` : "");
}

// ---- Mode switch: Network / Compare / Works ----
// Each mode keeps its own selections; switching only changes what is shown.
const MODE_HELP = {
  "tag:full": "Explore the whole hashtag network. Use the filters to hide tags or thin out weak links.",
  "tag:comparison": "Pick two or more hashtags to see which tags sit near each one, and which they share.",
  "tag:works": "Pick hashtags to list and map the works that carry them.",
  "work:full": "Each node is a work. Works are linked when their hashtags overlap, and more similar works sit closer together; bigger nodes are linked to more works. Hover for the full title, click for details.",
  "work:comparison": "Pick two or more works to see which hashtags they share and which belong to only one of them."
};

function setupModeSwitch() {
  d3.selectAll("#mode-switch button").on("click", function () {
    setViewMode(this.dataset.mode);
  });
  d3.selectAll("#lens-switch button").on("click", function () {
    setLens(this.dataset.lens);
  });
  setLens(state.lens, true);
}

function setLens(lens, initial = false) {
  state.lens = lens;
  d3.selectAll("#lens-switch button")
    .classed("active", function () { return this.dataset.lens === lens; })
    .attr("aria-pressed", function () { return this.dataset.lens === lens ? "true" : "false"; });
  // "Find works" only exists in the hashtag lens.
  d3.select('#mode-switch button[data-mode="works"]').classed("mode-hidden", lens === "work");
  d3.select("#mode-switch").classed("two-tabs", lens === "work");
  if (lens === "work" && state.viewMode === "works") state.viewMode = "full";
  setViewMode(state.viewMode, initial);
}

function setViewMode(mode, initial = false) {
  state.viewMode = mode;
  const key = `${state.lens}:${mode}`;
  d3.selectAll("#mode-switch button")
    .classed("active", function () { return this.dataset.mode === mode; })
    .attr("aria-pressed", function () { return this.dataset.mode === mode ? "true" : "false"; });
  d3.selectAll("[data-modes]").classed("mode-hidden", function () {
    return !this.dataset.modes.split(" ").includes(key);
  });
  d3.select("#mode-help").text(MODE_HELP[key] || "");
  hideNodeTooltip();
  d3.select("#inspector").html(state.lens === "work"
    ? "Click a link between two works to see the hashtags they share."
    : "Click a hashtag node or edge to inspect it.");
  if (!initial) updateNetwork();
}


// Works selection is independent of the Compare Tags controls.
function getMatchingWorks() {
  const selected = Array.from(state.worksTags);
  if (!selected.length) return [];
  return state.works.filter(work => {
    const tags = state.tagsByWork.get(work.work_id);
    if (!tags) return false;
    return state.worksMatchMode === "all"
      ? selected.every(tag => tags.has(tag))
      : selected.some(tag => tags.has(tag));
  });
}

function buildWorksGraph() {
  const chosen = Array.from(state.worksTags);
  const matched = getMatchingWorks();
  const nodes = chosen.map(tag => ({
    id: tag, label: tag, type: "tag",
    category: state.metaByTag.get(tag)?.category || "unknown",
    frequency: state.frequencyByTag.get(tag) || 0
  }));
  const links = [];
  for (const work of matched) {
    const id = `work:${work.work_id}`;
    const tags = state.tagsByWork.get(work.work_id) || new Set();
    nodes.push({ id, label: work.title || work.work_id,
      type: "work", work_id: work.work_id, frequency: 1,
      matchedTags: chosen.filter(tag => tags.has(tag)),
      matchCount: chosen.filter(tag => tags.has(tag)).length,
      category: "work" });
    for (const tag of chosen) {
      if (tags.has(tag)) links.push({ source: tag, target: id, weight: 1, type: "tag-work" });
    }
  }
  return { mode: "works", nodes, links, matchedWorks: matched, worksTags: chosen };
}

function setupWorksControls() {
  const categorySelect = d3.select("#works-category");
  const tagSelect = d3.select("#works-tag");
  if (categorySelect.empty() || tagSelect.empty()) {
    console.error("Matching Works selectors are missing from index.html.");
    return;
  }

  const categories = Array.from(new Set(
    Array.from(state.frequencyByTag.keys())
      .map(tag => state.metaByTag.get(tag)?.category || "unknown")
  )).sort();

  categorySelect.selectAll("option")
    .data(categories).join("option")
    .attr("value", d => d)
    .text(d => formatCategory(d));

  if (!categories.length) {
    categorySelect.selectAll("option").data(["No tags loaded"]).join("option")
      .attr("value", "").text(d => d);
    d3.select("#works-mode-help").text("No hashtag data loaded. Check data/work_tags.csv and reload.");
  }

  categorySelect.on("change", updateWorksTagDropdown);
  d3.select("#add-works-tag").on("click", () => {
    const tag = d3.select("#works-tag").property("value");
    if (!tag || state.worksTags.has(tag)) return;
    state.worksTags.add(tag);
    renderWorksChips();
    updateWorksTagDropdown();
    updateNetwork();
  });
  d3.selectAll('input[name="works-match"]').on("change", function() {
    if (!this.checked) return;
    state.worksMatchMode = this.value;
    updateNetwork();
  });
  d3.select("#toggle-works-list").on("click", () => {
    state.worksListVisible = !state.worksListVisible;
    d3.select("#works-list").classed("hidden", !state.worksListVisible);
    d3.select("#toggle-works-list").text(state.worksListVisible ? "Hide list" : "Show list");
  });
  updateWorksTagDropdown();
  renderWorksChips();
  renderWorksList();
}

function updateWorksTagDropdown() {
  const category = d3.select("#works-category").property("value");
  if (!category) return;
  const available = Array.from(state.frequencyByTag.keys())
    .filter(tag => (state.metaByTag.get(tag)?.category || "unknown") === category)
    .filter(tag => !state.worksTags.has(tag))
    .sort((a, b) => a.localeCompare(b, "ko"));
  const options = available.length ? available : [""];
  d3.select("#works-tag").selectAll("option").data(options).join("option")
    .attr("value", d => d)
    .text(d => d || "No more tags in this category");
  d3.select("#add-works-tag").property("disabled", !available.length);
}

function renderWorksChips() {
  const panel = d3.select("#selected-works-tags");
  const tags = Array.from(state.worksTags);
  if (!tags.length) {
    panel.text("No tags selected.");
    return;
  }
  clearPlaceholderText(panel);
  const chips = panel.selectAll("span.tag-chip").data(tags, d => d)
    .join("span").attr("class", "tag-chip");
  chips.html("");
  chips.append("span").text(d => d);
  chips.append("button").attr("type", "button").attr("aria-label", d => `Remove ${d}`)
    .text("×").on("click", (event, tag) => {
      state.worksTags.delete(tag);
      renderWorksChips();
      updateWorksTagDropdown();
      updateNetwork();
    });
}

function renderWorksList() {
  const panel = d3.select("#works-list");
  if (panel.empty()) return;
  const count = d3.select("#works-count");
  if (!state.worksTags.size) {
    count.text("");
    d3.select("#works-mode-help").text("Choose tags to explore their intersection (AND) or union (OR).");
    d3.select("#works-breakdown").html("");
    panel.text("Add a tag to see matching works.");
    return;
  }
  const works = getMatchingWorks();
  d3.select("#works-mode-help").text(state.worksMatchMode === "all"
    ? "AND: Each work must contain every selected tag."
    : "OR: Each work must contain at least one selected tag. Filled circles indicate works matching multiple tags.");
  const breakdown = d3.select("#works-breakdown");
  const matchCounts = new Map();
  for (const work of works) {
    const tags = state.tagsByWork.get(work.work_id) || new Set();
    const matched = Array.from(state.worksTags).filter(tag => tags.has(tag)).length;
    matchCounts.set(matched, (matchCounts.get(matched) || 0) + 1);
  }
  const groups = Array.from(matchCounts.entries()).sort((a,b) => b[0] - a[0]);
  breakdown.selectAll("div.works-breakdown-row")
    .data(groups, d => d[0]).join("div")
    .attr("class", "works-breakdown-row")
    .text(d => `${d[0]} of ${state.worksTags.size} selected tags: ${d[1]} work(s)`);
  count.text(`${works.length} matching work(s) · ${state.worksMatchMode === "all" ? "ALL" : "ANY"} of ${state.worksTags.size} selected tag(s)`);
  if (!works.length) {
    panel.text("No matching works. Try removing a tag or switching to ANY.");
    return;
  }
  clearPlaceholderText(panel);
  panel.selectAll("button.work-list-item")
    .data(works, d => d.work_id)
    .join("button")
    .attr("type", "button")
    .attr("class", "work-list-item")
    .text(d => {
      const tags = state.tagsByWork.get(d.work_id) || new Set();
      const n = Array.from(state.worksTags).filter(tag => tags.has(tag)).length;
      return `${d.title || d.work_id} (${n}/${state.worksTags.size})`;
    })
    .on("click", (event, d) => openWorkCard(d.work_id));
}

function showWorkInspector(work) {
  const tags = Array.from(state.tagsByWork.get(work.work_id) || []);
  const safe = v => String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  d3.select("#inspector").html(`
    <h3>${safe(work.title || work.work_id)}</h3>
    <p><strong>Author:</strong> ${safe(work.writer || "Unknown")}</p>
    <p><strong>Work ID:</strong> ${safe(work.work_id)}</p>
    <h4>All hashtags (${tags.length})</h4>
    <div class="work-tag-cloud">${tags.map(tag => `<span>${safe(tag)}</span>`).join("")}</div>
  `);
}

// =====================================================================
// Work lens
// =====================================================================
const ROMANCE_TAG = "로맨스판타지";
const HIGHLIGHT_PALETTE = ["#d1495b", "#2e86ab", "#e09f3e", "#5b8e3e", "#8e5ea2", "#2a9d8f"];

function shortTitle(title, max = 11) {
  const t = String(title || "").trim();
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
}

function workRank(work) {
  const r = parseInt(work && work.rank, 10);
  return Number.isFinite(r) ? r : 9999;
}

// Works that have hashtag data, in ranking order.
function worksWithTags() {
  return state.works
    .filter((w) => state.tagsByWork.has(w.work_id))
    .sort((a, b) => workRank(a) - workRank(b));
}

// The hashtags used to measure similarity (optionally without 로맨스판타지).
function similarityTags(workId) {
  const tags = new Set(state.tagsByWork.get(workId) || []);
  if (!state.includeRomance) tags.delete(ROMANCE_TAG);
  return tags;
}

// Work-to-work network. Edge weight = Jaccard similarity
//   shared hashtags / all distinct hashtags the two works have together.
function buildWorkGraph() {
  const works = worksWithTags();
  const sets = new Map(works.map((w) => [w.work_id, similarityTags(w.work_id)]));
  const degree = new Map(works.map((w) => [w.work_id, 0]));
  const links = [];

  for (let i = 0; i < works.length; i++) {
    for (let j = i + 1; j < works.length; j++) {
      const a = sets.get(works[i].work_id);
      const b = sets.get(works[j].work_id);
      let shared = 0;
      for (const t of a) if (b.has(t)) shared++;
      const union = a.size + b.size - shared;
      const jaccard = union ? shared / union : 0;
      if (shared > 0 && jaccard >= state.minJaccard - 1e-9) {
        links.push({ source: works[i].work_id, target: works[j].work_id, weight: jaccard, shared });
        degree.set(works[i].work_id, degree.get(works[i].work_id) + 1);
        degree.set(works[j].work_id, degree.get(works[j].work_id) + 1);
      }
    }
  }

  const nodes = works.map((w) => ({
    id: w.work_id,
    type: "work",
    work_id: w.work_id,
    label: w.title || w.work_id,
    shortLabel: shortTitle(w.title || w.work_id),
    degree: degree.get(w.work_id),
    frequency: sets.get(w.work_id).size,
    category: "work"
  }));

  return { mode: "worknet", nodes, links };
}

// Compare 2+ works: the works are anchors, their hashtags are grouped by
// which of the selected works carry them (shared by all / some / only one).
function buildWorkComparisonGraph() {
  const selected = Array.from(state.compareWorks);
  const tagSets = new Map(selected.map((id) => [id, new Set(state.tagsByWork.get(id) || [])]));
  const nodes = selected.map((id) => {
    const w = state.worksById.get(id) || {};
    return {
      id, type: "work", work_id: id,
      label: w.title || id,
      category: "work",
      frequency: tagSets.get(id).size,
      comparisonGroup: "anchor",
      comparisonSubset: [id],
      comparisonKey: "anchor:" + id
    };
  });
  const links = [];
  const allTags = new Set();
  for (const set of tagSets.values()) for (const t of set) allTags.add(t);

  for (const tag of allTags) {
    const subset = selected.filter((id) => tagSets.get(id).has(tag));
    const group = subset.length === selected.length ? "all" : subset.length === 1 ? "only" : "some";
    nodes.push({
      id: tag, label: tag, type: "tag",
      category: state.metaByTag.get(tag)?.category || "unknown",
      frequency: state.frequencyByTag.get(tag) || 0,
      comparisonGroup: group,
      comparisonSubset: subset,
      comparisonKey: subset.join("|||"),
      comparisonWeights: selected.map((id) => ({ selected: id, weight: tagSets.get(id).has(tag) ? 1 : 0 })),
      comparisonTotalWeight: subset.length
    });
    for (const id of subset) links.push({ source: id, target: tag, weight: 1 });
  }

  return { mode: "comparison", lens: "work", compareTags: selected, nodes, links };
}

function setupWorkLensControls() {
  // Similarity slider + 로맨스판타지 toggle
  d3.select("#min-jaccard").on("input", function () {
    state.minJaccard = +this.value;
    d3.select("#jaccard-value").text(state.minJaccard.toFixed(2));
    updateNetwork();
  });
  d3.select("#include-romance").on("change", function () {
    state.includeRomance = this.checked;
    updateNetwork();
  });

  // Colour by hashtag
  const categories = Array.from(new Set(state.metadata.map((d) => d.category))).sort();
  d3.select("#hl-category").selectAll("option").data(categories).join("option")
    .attr("value", (d) => d).text((d) => formatCategory(d));
  d3.select("#hl-category").on("change", updateHighlightDropdown);
  d3.select("#add-hl-tag").on("click", () => {
    const tag = d3.select("#hl-tag").property("value");
    if (!tag || state.highlightTags.has(tag)) return;
    if (state.highlightTags.size >= HIGHLIGHT_PALETTE.length) {
      d3.select("#hl-note").text(`Up to ${HIGHLIGHT_PALETTE.length} hashtags. Remove one to add another.`);
      return;
    }
    const used = new Set(state.highlightTags.values());
    state.highlightTags.set(tag, HIGHLIGHT_PALETTE.find((c) => !used.has(c)));
    afterHighlightChange();
  });
  d3.select("#clear-hl-tags").on("click", () => {
    state.highlightTags.clear();
    afterHighlightChange();
  });

  // Compare works: type to narrow the list, pick from the dropdown, or press Enter
  const addSelectedWork = () => {
    const id = d3.select("#cw-work").property("value");
    if (!id || state.compareWorks.has(id)) return;
    state.compareWorks.add(id);
    d3.select("#cw-search").property("value", "");
    updateNetwork();
  };
  d3.select("#add-cw").on("click", addSelectedWork);
  d3.select("#cw-search")
    .on("input", renderCompareWorksOptions)
    .on("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); addSelectedWork(); }
    });
  d3.select("#clear-cw").on("click", () => {
    state.compareWorks.clear();
    updateNetwork();
  });

  updateHighlightDropdown();
  renderHighlightChips();
  renderCompareWorksChips();
}

function updateHighlightDropdown() {
  const category = d3.select("#hl-category").property("value");
  const tags = Array.from(state.frequencyByTag.keys())
    .filter((t) => (state.metaByTag.get(t)?.category || "unknown") === category && !state.highlightTags.has(t))
    .sort((a, b) => a.localeCompare(b, "ko"));
  const options = tags.length ? tags : [""];
  d3.select("#hl-tag").selectAll("option").data(options).join("option")
    .attr("value", (d) => d)
    .text((d) => d ? `${d} (${state.frequencyByTag.get(d)})` : "No more tags in this category");
}

// Recolour in place so picking a colour does not re-run the layout.
function afterHighlightChange() {
  d3.select("#hl-note").text("");
  updateHighlightDropdown();
  renderHighlightChips();
  const isWorkNet = state.currentGraph && state.currentGraph.mode === "worknet";
  graphLayer.selectAll("g.node").each(function (d) {
    const sel = d3.select(this);
    sel.select("circle")
      .attr("fill", nodeColor(d))
      .attr("stroke", nodeStroke(d))
      .attr("stroke-width", nodeStrokeWidth(d));
    if (isWorkNet) renderNodePie(sel, d);
  });
}

function renderHighlightChips() {
  const panel = d3.select("#hl-chips");
  if (panel.empty()) return;
  const entries = Array.from(state.highlightTags.entries());
  if (!entries.length) {
    panel.selectAll("*").remove();
    panel.text("No hashtags coloured. All works are white.");
    return;
  }
  clearPlaceholderText(panel);
  const visible = new Set(worksWithTags().map((w) => w.work_id));
  const chips = panel.selectAll("span.hl-chip").data(entries, (d) => d[0])
    .join("span").attr("class", "tag-chip hl-chip");
  chips.html("");
  chips.append("span").attr("class", "hl-swatch").style("background", (d) => d[1]);
  chips.append("span").text(([tag]) => {
    let n = 0;
    for (const [id, tags] of state.tagsByWork) if (visible.has(id) && tags.has(tag)) n++;
    return `${tag} · ${n}`;
  });
  chips.append("button").attr("type", "button").attr("aria-label", (d) => `Remove ${d[0]}`)
    .text("×").on("click", (event, [tag]) => {
      state.highlightTags.delete(tag);
      afterHighlightChange();
    });
}

function renderCompareWorksOptions() {
  const q = String(d3.select("#cw-search").property("value") || "").trim().toLowerCase().replace(/\s+/g, "");
  const options = worksWithTags()
    .filter((w) => !state.compareWorks.has(w.work_id))
    .filter((w) => !q || `#${w.rank}${w.title}${w.writer || ""}`.toLowerCase().replace(/\s+/g, "").includes(q));
  const sel = d3.select("#cw-work");
  sel.selectAll("option").data(options.length ? options : [null], (d) => (d ? d.work_id : "none")).join("option")
    .attr("value", (d) => (d ? d.work_id : ""))
    .text((d) => (d ? `#${d.rank} ${d.title}` : "No matching works"));
  d3.select("#cw-search-count").text(q ? `${options.length} match${options.length === 1 ? "" : "es"}` : "");
  d3.select("#add-cw").property("disabled", !options.length);
}

function renderCompareWorksChips() {
  renderCompareWorksOptions();

  const panel = d3.select("#cw-chips");
  if (panel.empty()) return;
  const ids = Array.from(state.compareWorks);
  if (!ids.length) {
    panel.selectAll("*").remove();
    panel.text("No works selected.");
    return;
  }
  clearPlaceholderText(panel);
  const chips = panel.selectAll("span.cw-chip").data(ids, (d) => d)
    .join("span").attr("class", "tag-chip cw-chip");
  chips.html("");
  chips.append("span").attr("class", "hl-swatch").style("background", (id) => compareColor(id));
  chips.append("span").attr("class", "cw-chip-text").attr("title", (id) => state.worksById.get(id)?.title || id)
    .text((id) => compareName(id, true));
  chips.append("button").attr("type", "button").text("×").on("click", (event, id) => {
    state.compareWorks.delete(id);
    updateNetwork();
  });
}

function renderWorkCompareResults() {
  const results = d3.select("#cw-results");
  const selected = Array.from(state.compareWorks);
  if (selected.length < 2) {
    results.html("Add two or more works to compare their hashtags.");
    return;
  }
  const graph = state.currentGraph;
  if (!graph || graph.mode !== "comparison" || graph.lens !== "work") return;

  const total = selected.length;
  const rows = graph.nodes.filter((n) => n.comparisonGroup && n.comparisonGroup !== "anchor");
  const byFreq = (a, b) => b.frequency - a.frequency || a.id.localeCompare(b.id, "ko");
  const dot = (color) => `<span class="cmp-dot" style="background:${color}"></span>`;
  const tagCloud = (items) => items.length
    ? `<div class="wc-tags">${items.sort(byFreq).map((r) =>
        `<span class="wc-tag" style="--tag-color:${categoryColor(r.category)}">${escapeHtml(r.id)}</span>`).join("")}</div>`
    : `<p class="small-note">None</p>`;
  const group = (title, color, items) => `
    <details class="compare-group" ${items.length ? "open" : ""}>
      <summary>${dot(color)}<span>${title}</span><span class="cmp-count">${items.length}</span></summary>
      ${tagCloud(items)}
    </details>`;

  let html = `<div class="cmp-anchors cmp-anchors-works">${selected.map((id) =>
    `<span class="cmp-anchor">${dot(compareColor(id))}${escapeHtml(compareName(id, true))}</span>`).join("")}</div>`;

  html += `<h4 class="cmp-heading">Intersection</h4>`;
  html += group(`Shared by all ${total}`, compareSubsetColor(selected, total), rows.filter((r) => r.comparisonGroup === "all"));

  if (total >= 3) {
    const partial = d3.groups(rows.filter((r) => r.comparisonGroup === "some"), (r) => r.comparisonKey)
      .map(([, items]) => ({ subset: items[0].comparisonSubset, items }))
      .sort((a, b) => b.subset.length - a.subset.length || b.items.length - a.items.length);
    html += `<h4 class="cmp-heading">Partial intersections</h4>`;
    html += partial.length
      ? partial.map((g) => group(escapeHtml(g.subset.map((id) => compareShortName(id)).join(" ∩ ")) + " only",
          compareSubsetColor(g.subset, total), g.items)).join("")
      : `<p class="small-note">No hashtags are shared by only some of the selected works.</p>`;
  }

  html += `<h4 class="cmp-heading">Differences</h4>`;
  html += selected.map((id) => group(`Only ${escapeHtml(compareName(id, true))}`, compareSubsetColor([id], total),
    rows.filter((r) => r.comparisonGroup === "only" && r.comparisonSubset[0] === id))).join("");

  results.html(html);
}

function showWorkEdgeInspector(edge) {
  const a = getLinkName(edge.source);
  const b = getLinkName(edge.target);
  const ta = similarityTags(a);
  const tb = similarityTags(b);
  const shared = Array.from(ta).filter((t) => tb.has(t)).sort((x, y) => (state.frequencyByTag.get(y) || 0) - (state.frequencyByTag.get(x) || 0));
  const onlyA = Array.from(ta).filter((t) => !tb.has(t));
  const onlyB = Array.from(tb).filter((t) => !ta.has(t));
  const chip = (t) => `<span class="wc-tag" style="--tag-color:${categoryColor(state.metaByTag.get(t)?.category)}">${escapeHtml(t)}</span>`;
  d3.select("#inspector").html(`
    <div class="inspector-card">
      <h3>${escapeHtml(compareName(a, true))}<br>↔ ${escapeHtml(compareName(b, true))}</h3>
      <p><strong>Similarity (Jaccard):</strong> ${edge.weight.toFixed(2)}
        <span class="small-note">= ${shared.length} shared ÷ ${shared.length + onlyA.length + onlyB.length} hashtags in total</span></p>
      <h4>Shared hashtags (${shared.length})</h4>
      <div class="wc-tags">${shared.map(chip).join("")}</div>
      <p class="small-note">${state.includeRomance ? "" : "로맨스판타지 is not counted (see Work Similarity)."}</p>
    </div>
  `);
}

function buildGraph() {
  const allTags = Array.from(state.frequencyByTag.keys());

  const selectedTags = new Set(
    allTags.filter((tag) => {
      const meta = state.metaByTag.get(tag);
      const category = meta ? meta.category : "unknown";
      const frequency = state.frequencyByTag.get(tag) || 0;

      if (state.excludedTags.has(tag)) return false;
      if (!state.selectedCategories.has(category)) return false;
      if (frequency < state.minFrequency) return false;

      return true;
    })
  );

  const nodes = Array.from(selectedTags).map((tag) => {
    const meta = state.metaByTag.get(tag) || {};

    return {
      id: tag,
      label: tag,
      category: meta.category || "unknown",
      description: meta.description || "",
      frequency: state.frequencyByTag.get(tag) || 0
    };
  });

  const pairWeights = new Map();

  for (const tagsSet of state.tagsByWork.values()) {
    const tags = Array.from(tagsSet)
      .filter((tag) => selectedTags.has(tag))
      .sort();

    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = pairKey(tags[i], tags[j]);
        pairWeights.set(key, (pairWeights.get(key) || 0) + 1);
      }
    }
  }

  const links = [];

  for (const [key, weight] of pairWeights.entries()) {
    if (weight >= state.minWeight) {
      const [source, target] = key.split("|||");
      links.push({ source, target, weight });
    }
  }

  return { nodes, links };
}

function buildComparisonGraph() {
  const baseGraph = buildGraph();
  const selectedTags = Array.from(state.compareTags);

  const nodeById = new Map(baseGraph.nodes.map((node) => [node.id, node]));

  const weightMap = new Map();

  for (const link of baseGraph.links) {
    const source = getLinkName(link.source);
    const target = getLinkName(link.target);
    weightMap.set(pairKey(source, target), link.weight);
  }

  const includedTags = new Set(selectedTags);
  const links = [];

  for (const node of baseGraph.nodes) {
    const target = node.id;

    if (state.compareTags.has(target)) continue;

    const weights = selectedTags.map((selected) => {
      return {
        selected,
        weight: weightMap.get(pairKey(selected, target)) || 0
      };
    });

    const totalWeight = d3.sum(weights, (d) => d.weight);

    if (totalWeight === 0) continue;

    includedTags.add(target);

    for (const item of weights) {
      if (item.weight > 0) {
        links.push({
          source: item.selected,
          target: target,
          weight: item.weight,
          comparisonEdge: true
        });
      }
    }
  }

  const nodes = Array.from(includedTags)
    .map((tag) => {
      const baseNode = nodeById.get(tag);

      if (!baseNode) return null;

      const weights = selectedTags.map((selected) => {
        return {
          selected,
          weight: weightMap.get(pairKey(selected, tag)) || 0
        };
      });

      const connectedTo = weights.filter((d) => d.weight > 0);
      const totalWeight = d3.sum(weights, (d) => d.weight);

      // Group by the exact combination of compare tags this tag co-occurs with:
      //   all  = linked to every compare tag (intersection)
      //   some = linked to more than one but not all (partial intersection)
      //   only = linked to exactly one (difference)
      const subset = connectedTo.map((d) => d.selected);
      let comparisonGroup;

      if (state.compareTags.has(tag)) {
        comparisonGroup = "anchor";
      } else if (subset.length === selectedTags.length) {
        comparisonGroup = "all";
      } else if (subset.length === 1) {
        comparisonGroup = "only";
      } else {
        comparisonGroup = "some";
      }

      return {
        ...baseNode,
        comparisonGroup,
        comparisonSubset: state.compareTags.has(tag) ? [tag] : subset,
        comparisonKey: state.compareTags.has(tag) ? "anchor:" + tag : subset.join("|||"),
        comparisonWeights: weights,
        comparisonTotalWeight: totalWeight,
        connectedCompareTags: connectedTo.map((d) => d.selected)
      };
    })
    .filter(Boolean);

  return {
    mode: "comparison",
    compareTags: selectedTags,
    nodes,
    links
  };
}

function pairKey(a, b) {
  return [a, b].sort().join("|||");
}

function getLinkName(endpoint) {
  return typeof endpoint === "object" ? endpoint.id : endpoint;
}

function drawNetwork(graph) {
  graphLayer.selectAll("*").remove();

  const networkArea = document.getElementById("network-area");
  const width = networkArea.clientWidth;
  const height = networkArea.clientHeight;

  svg.attr("viewBox", `0 0 ${width} ${height}`);

 const nodes = graph.nodes.map((d) => {
  const node = { ...d };

  {
    const fixed = currentPins().get(d.id);

    if (fixed) {
      node.x = fixed.x;
      node.y = fixed.y;
      node.fx = fixed.x;
      node.fy = fixed.y;
    }
  }

  return node;
});

  let links = graph.links.map((d) => ({ ...d }));

  if (graph.mode === "comparison") {
    const anchorTags = new Set(graph.compareTags || Array.from(state.compareTags));

    links = links.filter((link) => {
      const source = getLinkName(link.source);
      const target = getLinkName(link.target);

      return anchorTags.has(source) || anchorTags.has(target);
    });
}

  let compareLayout = null;

  if (graph.mode === "comparison") {
    compareLayout = compareAnchorPositions(graph.compareTags, width, height);
    for (const n of nodes) {
      const t = comparisonTarget(n, compareLayout, graph.compareTags.length);
      n.tx = t.x;
      n.ty = t.y;
      // Start each node near its region so the layout settles quickly
      // (pinned nodes stay where they were pinned).
      if (n.fx == null) {
        n.x = t.x + (Math.random() - 0.5) * 120;
        n.y = t.y + (Math.random() - 0.5) * 120;
      }
    }
  }

  const isCompare = graph.mode === "comparison";

  const simulation = d3.forceSimulation(nodes)
  .force("link", (() => {
    const force = d3.forceLink(links).id((d) => d.id).distance((d) => {
      if (graph.mode === "works") return 145;
      if (graph.mode === "worknet") return 40 + (1 - d.weight) * 160;
      if (isCompare) return 120;
      return 150;
    });
    // In comparison mode a tag hangs from each compare anchor it links to, so
    // shared tags settle between anchors and unique ones float outside, just
    // like in the main network. (Never pass null to strength: that turns it off.)
    if (isCompare) force.strength((l) => 0.5 / Math.max(1, (l.target.comparisonSubset || [1]).length));
    return force;
  })())
  .force("charge", d3.forceManyBody().strength((d) => {
    if (graph.mode === "works") return d.type === "work" ? -75 : -450;
    if (graph.mode === "worknet") return -250;
    if (isCompare) return d.comparisonGroup === "anchor" ? -600 : -200;
    return -380;
  }))
  .force("collision", d3.forceCollide().radius((d) => nodeRadius(d) + (isCompare ? 9 : graph.mode === "worknet" ? 14 : 10)));

  // Keep every node inside the visible map area.
  simulation.force("bounds", () => {
    for (const n of nodes) {
      if (n.fx != null) continue;
      const r = nodeRadius(n) + 8;
      n.x = Math.max(r, Math.min(width - r, n.x));
      n.y = Math.max(r + 14, Math.min(height - r - 14, n.y));
    }
  });

  if (isCompare) {
    simulation
      // Anchors hold their slots; everything else only gets a light nudge
      // toward its region and is otherwise free, like the main network.
      .force("x", d3.forceX((d) => d.tx).strength((d) => (d.comparisonGroup === "anchor" ? 0.6 : 0.035)))
      .force("y", d3.forceY((d) => d.ty).strength((d) => (d.comparisonGroup === "anchor" ? 0.6 : 0.035)));
  } else {
    simulation
      .force("center", d3.forceCenter(width / 2, height / 2))
      // Gentle pull toward the middle keeps the spread-out layout on screen.
      .force("x", d3.forceX(width / 2).strength(graph.mode === "works" ? 0 : graph.mode === "worknet" ? 0.12 : 0.06))
      .force("y", d3.forceY(height / 2).strength(graph.mode === "works" ? 0 : graph.mode === "worknet" ? 0.16 : 0.08));
  }

  const link = graphLayer.append("g")
    .attr("class", "links")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "link")
    .attr("stroke", (d) => {
      if (graph.mode === "works" || graph.mode === "worknet") return "#9c9692";
      if (isCompare) {
        const s = getLinkName(d.source);
        const t = getLinkName(d.target);
        return d3.interpolateRgb(compareColor(activeCompareSet().has(s) ? s : t), "#9a9a9a")(0.45);
      }
      return "#999";
    })
    .attr("stroke-opacity", isCompare ? 0.32 : graph.mode === "worknet" ? 0.4 : 0.45)
    .attr("stroke-width", (d) => {
      if (graph.mode === "works") return 1.2;
      if (graph.mode === "worknet") return 0.6 + d.weight * 7;
      if (graph.mode === "comparison") return graph.lens === "work" ? 1 : 0.6 + Math.sqrt(d.weight) * 0.6;
      return Math.sqrt(d.weight);
    })
    .on("click", function (event, d) {
      event.stopPropagation();
      if (graph.mode === "works") return;
      if (graph.mode === "worknet") showWorkEdgeInspector(d);
      else if (graph.lens !== "work") showEdgeInspector(d);
    });

  let regionLabels = null;

  if (isCompare) {
    const total = graph.compareTags.length;
    const groups = d3.groups(
      nodes.filter((n) => n.comparisonGroup !== "anchor"),
      (n) => n.comparisonKey
    );
    regionLabels = graphLayer.append("g")
      .attr("class", "compare-region-labels")
      .selectAll("text")
      .data(groups)
      .join("text")
      .attr("class", "compare-region-label")
      .attr("text-anchor", "middle")
      .attr("fill", ([, members]) => d3.color(compareSubsetColor(members[0].comparisonSubset, total)).darker(0.6))
      .text(([, members]) => `${compareSubsetLabel(members[0].comparisonSubset, total)} · ${members.length}`);
  }

  const node = graphLayer.append("g")
  .attr("class", "nodes")
  .selectAll("g")
  .data(nodes)
  .join("g")
  .attr("class", "node")
  .call(drag(simulation))
  .on("mouseenter", function (event, d) {
    // Work nodes: hover shows the title label only.
    if (d.type === "work") {
      if (graph.mode === "worknet") {
        d3.select(this).raise().select("text").text(d.label).classed("is-hovered", true);
      } else {
        d3.select(this).select("text").style("display", null);
      }
      return;
    }
    showNodeInspector(d);
    showNodeTooltip(event, d);
  })
  .on("click", function (event, d) {
    event.stopPropagation();
    // Wait briefly so a double-click (pin toggle) does not also count as a click.
    clearTimeout(nodeClickTimer);
    nodeClickTimer = setTimeout(() => {
      if (d.type === "work") openWorkCard(d.work_id);
      else showNodeInspector(d);
    }, 230);
  })
  .on("mousemove", function (event, d) {
    if (d.type !== "work") moveNodeTooltip(event);
  })
  .on("mouseleave", function (event, d) {
    if (d.type === "work" && graph.mode === "works") d3.select(this).select("text").style("display", "none");
    if (d.type === "work" && graph.mode === "worknet") d3.select(this).select("text").text(d.shortLabel).classed("is-hovered", false);
    hideNodeTooltip();
  })
  .on("dblclick", function (event, d) {
    event.stopPropagation();
    clearTimeout(nodeClickTimer);
    togglePin(d, d3.select(this));
    simulation.alpha(0.3).restart();
  });
  
  node.append("circle")
    .attr("r", (d) => circleRadius(d))
    .attr("fill", (d) => nodeColor(d))
    .attr("stroke", (d) => nodeStroke(d))
    .attr("stroke-width", (d) => nodeStrokeWidth(d));

  if (graph.mode === "worknet") {
    node.append("g").attr("class", "node-pie");
    node.each(function (d) { renderNodePie(d3.select(this), d); });
  }
  
  node.append("text")
    .text((d) => graph.mode === "worknet" ? d.shortLabel : d.label)
    .style("display", (d) => d.type === "work" && graph.mode === "works" ? "none" : null)
    .attr("class", "node-label")
    .attr("x", (d) => circleRadius(d) + 4)
    .attr("y", 4)
    .attr("font-size", (d) => {
      if (graph.mode === "worknet") return "11px";
      if (d.type === "work" && !isCompareAnchor(d.id)) return "12px";
      return "13.5px";
    })
    .attr("font-weight", (d) => (graph.mode === "works" ? state.worksTags.has(d.id) : isCompareAnchor(d.id)) ? 700 : 400)
    .attr("fill", (d) => isCompareAnchor(d.id) ? "#111111" : "#333333");
  
  // Draw positions, bent through the magnifier when it is on.
  const render = () => {
    const f = fisheyeFocus();
    if (f) {
      for (const n of nodes) n.__fe = applyFisheye(n, f);
    }
    const pos = (n) => (f && n.__fe ? n.__fe : n);
    link
      .attr("x1", (d) => pos(d.source).x)
      .attr("y1", (d) => pos(d.source).y)
      .attr("x2", (d) => pos(d.target).x)
      .attr("y2", (d) => pos(d.target).y);
    node.attr("transform", (d) => {
      const p = pos(d);
      return f && p.z > 1.001 ? `translate(${p.x},${p.y}) scale(${p.z})` : `translate(${p.x},${p.y})`;
    });
  };
  currentRender = render;

  simulation.on("tick", () => {
    render();

    // Keep each region label just outside its cluster (above it in the top
    // half of the map, below it in the bottom half).
    if (regionLabels) {
      regionLabels
        .attr("x", ([, members]) => d3.mean(members, (m) => m.x))
        .attr("y", ([, members]) => {
          const below = members[0].ty >= compareLayout.cy;
          return below
            ? d3.max(members, (m) => m.y + nodeRadius(m)) + 16
            : d3.min(members, (m) => m.y - nodeRadius(m)) - 8;
        });
    }
  });
}


const COMPARE_PALETTE = ["#d1495b", "#2e86ab", "#e09f3e", "#5b8e3e", "#8e5ea2", "#2a9d8f", "#b5651d", "#6c757d"];

function compareColor(tag) {
  const tags = (state.currentGraph && state.currentGraph.compareTags) || Array.from(state.compareTags);
  const i = Math.max(0, tags.indexOf(tag));
  return COMPARE_PALETTE[i % COMPARE_PALETTE.length];
}

// Colour for a combination of compare tags: one tag -> its colour (lightened),
// every tag -> dark neutral, a partial set -> blend of its tags' colours.
function compareSubsetColor(subset, total) {
  if (!subset || !subset.length) return "#d0d0d0";
  if (subset.length === total) return "#3d3633";
  const colors = subset.map((t) => d3.rgb(compareColor(t)));
  const mix = d3.rgb(
    d3.mean(colors, (c) => c.r), d3.mean(colors, (c) => c.g), d3.mean(colors, (c) => c.b)
  );
  return subset.length === 1
    ? d3.interpolateRgb(mix, "#ffffff")(0.3)
    : d3.interpolateRgb(mix, "#8a8380")(0.35);
}

// Display names for compare anchors: hashtags as-is; works as "#rank title"
// (long form) or "#rank" (short form, used on the map).
function compareName(id, long = false) {
  const w = state.lens === "work" ? state.worksById.get(id) : null;
  if (!w) return id;
  return long ? `#${w.rank} ${w.title}` : (w.title || id);
}

function compareShortName(id) {
  const w = state.lens === "work" ? state.worksById.get(id) : null;
  return w ? `#${w.rank}` : id;
}

function activeCompareSet() {
  return state.lens === "work" ? state.compareWorks : state.compareTags;
}

function compareSubsetLabel(subset, total) {
  if (!subset || !subset.length) return "";
  if (subset.length === total && total > 1) return `Shared by all ${total}`;
  if (subset.length === 1) return `Only ${compareShortName(subset[0])}`;
  return subset.map(compareShortName).join(" ∩ ") + " only";
}

// Anchor positions: two tags sit left/right; three or more sit on an ellipse.
function compareAnchorPositions(tags, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width * 0.28;
  const ry = height * (tags.length === 2 ? 0.29 : 0.22);
  const map = new Map();
  tags.forEach((tag, i) => {
    const angle = tags.length === 2
      ? (i === 0 ? Math.PI : 0)
      : -Math.PI / 2 + (2 * Math.PI * i) / tags.length;
    map.set(tag, { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  });
  return { cx, cy, map };
}

// Target point for a node: anchors at their slot, the full intersection in the
// middle, a partial intersection between its tags, a difference outside its tag.
function comparisonTarget(d, layout, total) {
  const { cx, cy, map } = layout;
  if (d.comparisonGroup === "anchor") return map.get(d.id);
  if (d.comparisonGroup === "all") return { x: cx, y: cy };

  const pts = (d.comparisonSubset || []).map((t) => map.get(t)).filter(Boolean);
  if (!pts.length) return { x: cx, y: cy };
  const mx = d3.mean(pts, (p) => p.x);
  const my = d3.mean(pts, (p) => p.y);
  if (d.comparisonGroup === "only") {
    return { x: mx + (mx - cx) * 0.36, y: my + (my - cy) * 0.36 };
  }

  // Partial intersection: keep it clearly away from the central "all" cluster.
  // Work in a normalised (circular) space so the ellipse does not distort it.
  const rx = d3.mean(Array.from(map.values()), (p) => Math.abs(p.x - cx)) || 1;
  const ry = d3.mean(Array.from(map.values()), (p) => Math.abs(p.y - cy)) || 1;
  let ux = (mx - cx) / rx;
  let uy = (my - cy) / ry;
  let dist = Math.hypot(ux, uy);
  if (dist < 0.05) {
    // Opposite tags (e.g. 1st and 3rd of four) average to the centre:
    // place the group to the side, perpendicular to the line between them.
    ux = -(pts[0].y - cy) / ry;
    uy = (pts[0].x - cx) / rx;
    dist = Math.hypot(ux, uy) || 1;
  }
  const r = Math.max(dist, 0.62);
  return { x: cx + (ux / dist) * r * rx, y: cy + (uy / dist) * r * ry };
}

function isCompareAnchor(id) {
  return state.viewMode === "comparison" && activeCompareSet().has(id);
}

function nodeRadius(d) {
  // Work network: size by how many other works a work is linked to.
  if (d.degree != null) return 5 + Math.sqrt(d.degree) * 2.6;
  if (d.type === "work" && d.comparisonGroup !== "anchor") return 6.5;
  return 6 + Math.sqrt(d.frequency || 1) * 2.6;
}

function circleRadius(d) {
  return isCompareAnchor(d.id) && d.degree == null ? nodeRadius(d) + 4 : nodeRadius(d);
}

// Hashtags picked under "Color by Hashtag" that this work carries.
function highlightMatches(d) {
  if (d.type !== "work" || !state.highlightTags.size) return [];
  const tags = state.tagsByWork.get(d.work_id) || new Set();
  return Array.from(state.highlightTags.keys()).filter((t) => tags.has(t));
}

// A work carrying two or more coloured hashtags is drawn as a pie, one equal
// slice per hashtag, so no single colour hides the others.
const pieArc = d3.arc().innerRadius(0);

function renderNodePie(nodeSel, d) {
  const hits = highlightMatches(d);
  const r = circleRadius(d) - 0.6;
  const slices = hits.length > 1 ? d3.pie().value(1).sort(null)(hits) : [];
  nodeSel.select("g.node-pie").selectAll("path")
    .data(slices)
    .join("path")
    .attr("d", (s) => pieArc.outerRadius(r)(s))
    .attr("fill", (s) => state.highlightTags.get(s.data))
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 0.6);
  // Keep the outline ring visible on top of the slices.
  nodeSel.select("circle").attr("fill-opacity", slices.length ? 0 : 1);
  if (slices.length) nodeSel.select("circle").raise();
  nodeSel.select("text").raise();
}

function nodeStroke(d) {
  if (currentPins().has(d.id)) return "#111111";
  const graph = state.currentGraph;
  if (graph && graph.mode === "worknet") {
    if (isCompareAnchor(d.id)) return "#111111";
    return "#8a817c";
  }
  if (isCompareAnchor(d.id)) return "#111111";
  return "#ffffff";
}

function nodeStrokeWidth(d) {
  if (currentPins().has(d.id) || isCompareAnchor(d.id)) return 3;
  const graph = state.currentGraph;
  if (graph && graph.mode === "worknet") return 1.1;
  return 1.5;
}

function nodeColor(d) {
  const graph = state.currentGraph;

  if (graph && graph.mode === "worknet") {
    const hits = highlightMatches(d);
    return hits.length ? state.highlightTags.get(hits[0]) : "#ffffff";
  }

  if (graph && graph.mode === "comparison") {
    if (d.comparisonGroup === "anchor") return compareColor(d.id);
    return compareSubsetColor(d.comparisonSubset, graph.compareTags.length);
  }

  if (d.type === "work") {
    return d.matchCount > 1 ? "#77716e" : "#ffffff";
  }

  if (graph && graph.mode === "works") return categoryColor(d.category);

  if (state.lens === "tag" && state.viewMode === "comparison" && state.compareTags.size > 0) {
    if (state.compareTags.has(d.id)) {
      return "#111111";
    }

    return "#cfcfcf";
  }

  return categoryColor(d.category);
}

function categoryColor(category) {
  if (category === "female_protagonist") return "#c95f7b";
  if (category === "male_protagonist") return "#4f7cac";
  if (category === "genre_plot") return "#6b8f71";
  if (category === "hybrid") return "#9b7ede";
  return "#999999";
}

let nodeClickTimer = null;

// ---- Magnifier (fisheye lens) ----
// When on, the area around the pointer is enlarged like a magnifying glass
// while the rest of the map stays put. Display-only: the layout is unchanged.
const magnifier = { on: false, focus: null, dragging: false, radius: 170, distortion: 3.2 };
let currentRender = null;

function fisheyeFocus() {
  return magnifier.on && !magnifier.dragging ? magnifier.focus : null;
}

// Circular fisheye (after Sarkar & Brown): returns distorted x, y and a zoom z.
function applyFisheye(p, focus) {
  const { radius, distortion } = magnifier;
  const e = Math.exp(distortion);
  const k0 = (e / (e - 1)) * radius;
  const k1 = distortion / radius;
  const dx = p.x - focus.x;
  const dy = p.y - focus.y;
  const dd = Math.sqrt(dx * dx + dy * dy);
  if (!dd || dd >= radius) return { x: p.x, y: p.y, z: dd >= radius ? 1 : Math.min(distortion, 3) };
  const k = (k0 * (1 - Math.exp(-dd * k1))) / dd * 0.75 + 0.25;
  return { x: focus.x + dx * k, y: focus.y + dy * k, z: Math.min(k, 3) };
}

function setupMagnifier() {
  const btn = d3.select("#network-area").append("button")
    .attr("id", "magnifier-toggle")
    .attr("type", "button")
    .attr("aria-pressed", "false")
    .attr("title", "Magnify the area under the pointer")
    .html('<span class="mag-icon" aria-hidden="true"></span><span class="mag-text">Magnifier</span>')
    .on("click", () => {
      magnifier.on = !magnifier.on;
      magnifier.focus = null;
      btn.classed("active", magnifier.on).attr("aria-pressed", String(magnifier.on));
      d3.select("#network-area").classed("magnifying", magnifier.on);
      if (currentRender) currentRender();
    });

  svg.on("mousemove.magnifier", (event) => {
    if (!magnifier.on) return;
    const [x, y] = d3.pointer(event, graphLayer.node());
    magnifier.focus = { x, y };
    if (currentRender) currentRender();
  });
  svg.on("mouseleave.magnifier", () => {
    if (!magnifier.on) return;
    magnifier.focus = null;
    if (currentRender) currentRender();
  });
}

function togglePin(d, nodeSelection) {
  if (currentPins().has(d.id)) {
    currentPins().delete(d.id);
    d.fx = null;
    d.fy = null;
  } else {
    currentPins().set(d.id, { x: d.x, y: d.y });
    d.fx = d.x;
    d.fy = d.y;
  }
  updatePinStatus();
  nodeSelection.select("circle")
    .attr("stroke", nodeStroke(d))
    .attr("stroke-width", nodeStrokeWidth(d));
}

// ---- Floating work cards (left side of the map) ----

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function getWorkCardLayer() {
  let layer = d3.select("#work-card-layer");
  if (layer.empty()) {
    layer = d3.select("#network-area").append("div").attr("id", "work-card-layer");
  }
  return layer;
}

function openWorkCard(workId) {
  const work = state.worksById.get(workId);
  if (!work) return;

  const layer = getWorkCardLayer();
  const existing = layer.select(`.work-card[data-work-id="${workId}"]`);
  if (!existing.empty()) {
    // Already open: move it to the top of the stack and flash it.
    layer.node().prepend(existing.node());
    existing.classed("flash", false);
    void existing.node().offsetWidth;
    existing.classed("flash", true);
    return;
  }

  const tags = Array.from(state.tagsByWork.get(workId) || []);
  const selected = state.worksTags;
  const tagHtml = tags.map((tag) => {
    const cat = state.metaByTag.get(tag)?.category || "unknown";
    const hit = selected.has(tag) ? " is-selected" : "";
    return `<span class="wc-tag${hit}" style="--tag-color:${categoryColor(cat)}">${escapeHtml(tag)}</span>`;
  }).join("");
  const synopsis = String(work.synopsis_summary || "").trim();

  const card = document.createElement("article");
  card.className = "work-card";
  card.dataset.workId = workId;
  card.innerHTML = `
    <button type="button" class="wc-close" aria-label="Close">×</button>
    <div class="wc-rank">#${escapeHtml(work.rank || "")} · ${escapeHtml(work.work_id)}</div>
    <h3>${escapeHtml(work.title || work.work_id)}</h3>
    <dl class="wc-meta">
      <div><dt>Author</dt><dd>${escapeHtml(work.writer || "Unknown")}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(work.form_of_publishment || "—")}</dd></div>
      <div><dt>Retrieved</dt><dd>${escapeHtml(work.retrieved_date || "—")}</dd></div>
    </dl>
    <h4>Hashtags (${tags.length})</h4>
    <div class="wc-tags">${tagHtml || "<span class='small-note'>No hashtags</span>"}</div>
    ${synopsis ? `<details class="wc-synopsis"><summary>Synopsis</summary><p>${escapeHtml(synopsis)}</p></details>` : ""}
  `;
  card.querySelector(".wc-close").addEventListener("click", (e) => {
    e.stopPropagation();
    card.remove();
  });
  layer.node().prepend(card);
}

function drag(simulation) {
  function dragstarted(event, d) {
    magnifier.dragging = true;
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.__startX = event.x;
    d.__startY = event.y;
    d.__moved = false;
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    // Ignore tiny jitters so an ordinary click never counts as a move.
    if (Math.hypot(event.x - d.__startX, event.y - d.__startY) > 4) d.__moved = true;
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragended(event, d) {
    magnifier.dragging = false;
    if (!event.active) simulation.alphaTarget(0);

    if (d.__moved) {
      // Dropped somewhere new: keep it there (pinned). Double-click releases it.
      d.fx = event.x;
      d.fy = event.y;
      currentPins().set(d.id, { x: event.x, y: event.y });
      d3.select(this).select("circle")
        .attr("stroke", nodeStroke(d))
        .attr("stroke-width", nodeStrokeWidth(d));
      updatePinStatus();
    } else if (!currentPins().has(d.id)) {
      d.fx = null;
      d.fy = null;
    }
  }

  return d3.drag()
    .on("start", dragstarted)
    .on("drag", dragged)
    .on("end", dragended);
}

function showNodeInspector(node) {
  console.log("SHOW INSPECTOR:", node);
  const connected = state.currentGraph.links
    .filter((link) => {
      const source = getLinkName(link.source);
      const target = getLinkName(link.target);

      return source === node.id || target === node.id;
    })
    .map((link) => {
      const source = getLinkName(link.source);
      const target = getLinkName(link.target);
      const other = source === node.id ? target : source;

      return {
        tag: other,
        weight: link.weight
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10);

  d3.select("#inspector").html(`
    <div class="inspector-card">
      <h3>${node.label}</h3>

      <div class="inspector-meta">
        <div><strong>Category</strong><br>${formatCategory(node.category)}</div>
        <div><strong>Frequency</strong><br>${node.frequency}</div>
        <div><strong>Pinned</strong><br>${currentPins().has(node.id) ? "Yes" : "No"}</div>
      </div>

      ${
        node.comparisonGroup && node.comparisonGroup !== "anchor"
          ? `<p><strong>Comparison group:</strong> ${compareSubsetLabel(node.comparisonSubset, activeCompareSet().size)}</p>`
          : ""
      }

      ${
        node.comparisonWeights
          ? renderComparisonBars(node.comparisonWeights)
          : ""
      }

      ${
        node.description
          ? `<p>${node.description}</p>`
          : ""
      }

      <h4>Strongest connections</h4>
      <ol class="inspector-list">
        ${
          connected.length > 0
            ? connected.map((d) => `<li><strong>${escapeHtml(compareName(d.tag, true))}</strong>: ${d.weight}</li>`).join("")
            : "<li>No visible connections under the current filters.</li>"
        }
      </ol>

      <p class="small-note">Drag a node to place it (it stays there). Double-click to pin or release it.</p>
    </div>
  `);
}

function showEdgeInspector(edge) {
  const source = getLinkName(edge.source);
  const target = getLinkName(edge.target);
  const works = getWorksForPair(source, target).slice(0, 10);

  d3.select("#inspector").html(`
    <strong>${source} ↔ ${target}</strong><br>
    Co-occurrence weight: ${edge.weight}<br><br>

    <strong>Appears together in</strong>
    <ol class="inspector-list">
      ${works.map((work) => `<li>${work.title || work.work_id}</li>`).join("")}
    </ol>

    ${works.length === 10 ? `<p class="small-note">Showing first 10 works.</p>` : ""}
  `);
}

function getWorksForPair(tagA, tagB) {
  const works = [];

  for (const [workId, tagsSet] of state.tagsByWork.entries()) {
    if (tagsSet.has(tagA) && tagsSet.has(tagB)) {
      works.push(state.worksById.get(workId) || { work_id: workId, title: workId });
    }
  }

  return works;
}

function compareSelectedTags() {
  const selectedTags = Array.from(state.compareTags);
  const results = d3.select("#compare-results");

  if (selectedTags.length < 2) {
    results.html("Add two or more tags to compare their co-occurrence patterns.");
    return;
  }

  const graph = state.currentGraph;
  if (!graph || graph.mode !== "comparison") return;

  const total = selectedTags.length;
  const rows = graph.nodes.filter((n) => n.comparisonGroup && n.comparisonGroup !== "anchor");
  const weightOf = (row, tag) => (row.comparisonWeights.find((w) => w.selected === tag) || {}).weight || 0;
  const dot = (color) => `<span class="cmp-dot" style="background:${color}"></span>`;
  const anchorChip = (tag) => `<span class="cmp-anchor">${dot(compareColor(tag))}${escapeHtml(tag)}</span>`;

  const listRows = (items, tags, limit) => {
    if (!items.length) return `<li class="small-note">None under the current filters</li>`;
    const shown = items.slice(0, limit).map((row) => {
      const values = tags.map((t) => `${escapeHtml(t)}: ${weightOf(row, t)}`).join(", ");
      return `<li>${escapeHtml(row.id)} <span class="small-note">(${values})</span></li>`;
    }).join("");
    const more = items.length > limit ? `<li class="small-note">+ ${items.length - limit} more</li>` : "";
    return shown + more;
  };

  const group = (title, color, items, tags, limit) => `
    <details class="compare-group" ${items.length ? "open" : ""}>
      <summary>${dot(color)}<span>${title}</span><span class="cmp-count">${items.length}</span></summary>
      <ul>${listRows(items, tags, limit)}</ul>
    </details>`;

  const byTotal = (a, b) => b.comparisonTotalWeight - a.comparisonTotalWeight;

  // Intersection
  const shared = rows.filter((r) => r.comparisonGroup === "all").sort(byTotal);
  let html = `<div class="cmp-anchors">${selectedTags.map(anchorChip).join("")}</div>`;
  html += `<h4 class="cmp-heading">Intersection</h4>`;
  html += group(`Shared by all ${total}`, compareSubsetColor(selectedTags, total), shared, selectedTags, 10);

  // Partial intersections (only when 3+ tags)
  if (total >= 3) {
    const partial = d3.groups(rows.filter((r) => r.comparisonGroup === "some"), (r) => r.comparisonKey)
      .map(([, items]) => ({ subset: items[0].comparisonSubset, items: items.sort(byTotal) }))
      .sort((a, b) => b.subset.length - a.subset.length || b.items.length - a.items.length);
    html += `<h4 class="cmp-heading">Partial intersections</h4>`;
    html += partial.length
      ? partial.map((g) => group(escapeHtml(g.subset.join(" ∩ ")) + " only", compareSubsetColor(g.subset, total), g.items, g.subset, 6)).join("")
      : `<p class="small-note">No tags are shared by only some of the selected tags.</p>`;
  }

  // Differences
  html += `<h4 class="cmp-heading">Differences</h4>`;
  html += selectedTags.map((tag) => {
    const items = rows
      .filter((r) => r.comparisonGroup === "only" && r.comparisonSubset[0] === tag)
      .sort((a, b) => weightOf(b, tag) - weightOf(a, tag));
    return group(`Only ${escapeHtml(tag)}`, compareSubsetColor([tag], total), items, [tag], 8);
  }).join("");

  results.html(html);
}
function renderComparisonBars(weights) {
  const maxWeight = d3.max(weights, (d) => d.weight) || 1;

  return `
    <div class="compare-weight-list">
      <h4>Comparison weights</h4>
      ${
        weights.map((item) => {
          const width = maxWeight === 0 ? 0 : (item.weight / maxWeight) * 100;

          return `
            <div class="compare-bar-row">
              <div class="compare-bar-label">
                <span>${escapeHtml(compareShortName(item.selected))}</span>
                <span>${item.weight}</span>
              </div>
              <div class="compare-bar-track">
                <div class="compare-bar-fill" style="width: ${width}%"></div>
              </div>
            </div>
          `;
        }).join("")
      }
    </div>
  `;
}

function showNodeTooltip(event, node) {
  if (node.type === "work") {
    d3.select("#node-tooltip").classed("hidden", false).text(node.label);
    moveNodeTooltip(event);
    return;
  }
  const connected = state.currentGraph.links
    .filter((link) => {
      const source = getLinkName(link.source);
      const target = getLinkName(link.target);

      return source === node.id || target === node.id;
    })
    .map((link) => {
      const source = getLinkName(link.source);
      const target = getLinkName(link.target);
      const other = source === node.id ? target : source;

      return {
        tag: other,
        weight: link.weight
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  d3.select("#node-tooltip")
    .classed("hidden", false)
    .html(`
      <strong>${node.label}</strong><br>
      Category: ${formatCategory(node.category)}<br>
      Frequency: ${node.frequency}<br>
      ${
        node.comparisonGroup && node.comparisonGroup !== "anchor"
          ? `Group: ${compareSubsetLabel(node.comparisonSubset, activeCompareSet().size)}<br>`
          : ""
      }
      ${
        connected.length > 0
          ? `<br><strong>#Top links</strong><br>${connected.map((d) => `${escapeHtml(compareName(d.tag, true))} (${d.weight})`).join("<br>")}`
          : ""
      }
    `);

  moveNodeTooltip(event);
}

function moveNodeTooltip(event) {
  d3.select("#node-tooltip")
    .style("left", `${event.clientX + 14}px`)
    .style("top", `${event.clientY + 14}px`);
}

function hideNodeTooltip() {
  d3.select("#node-tooltip")
    .classed("hidden", true);
}

function buildGlobalGraphStats() {
  const categoryCounts = new Map();
  const degreeByTag = new Map();
  const weightedDegreeByTag = new Map();

  const allTags = Array.from(state.frequencyByTag.keys())
    .filter((tag) => tag && tag !== "N/A");

  for (const tag of allTags) {
    const meta = state.metaByTag.get(tag);
    const category = meta ? meta.category : "unknown";

    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    degreeByTag.set(tag, 0);
    weightedDegreeByTag.set(tag, 0);
  }

  const pairWeights = new Map();

  for (const tagsSet of state.tagsByWork.values()) {
    const tags = Array.from(tagsSet)
      .filter((tag) => tag && tag !== "N/A")
      .sort();

    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = pairKey(tags[i], tags[j]);
        pairWeights.set(key, (pairWeights.get(key) || 0) + 1);
      }
    }
  }

  for (const [key, weight] of pairWeights.entries()) {
    const [source, target] = key.split("|||");

    if (!degreeByTag.has(source)) degreeByTag.set(source, 0);
    if (!degreeByTag.has(target)) degreeByTag.set(target, 0);

    if (!weightedDegreeByTag.has(source)) weightedDegreeByTag.set(source, 0);
    if (!weightedDegreeByTag.has(target)) weightedDegreeByTag.set(target, 0);

    degreeByTag.set(source, degreeByTag.get(source) + 1);
    degreeByTag.set(target, degreeByTag.get(target) + 1);

    weightedDegreeByTag.set(source, weightedDegreeByTag.get(source) + weight);
    weightedDegreeByTag.set(target, weightedDegreeByTag.get(target) + weight);
  }

  const tagsByCategory = new Map();

  for (const tag of allTags) {
    const meta = state.metaByTag.get(tag);
    const category = meta ? meta.category : "unknown";

    if (!tagsByCategory.has(category)) {
      tagsByCategory.set(category, []);
    }

    tagsByCategory.get(category).push({
      tag,
      category,
      frequency: state.frequencyByTag.get(tag) || 0,
      degree: degreeByTag.get(tag) || 0,
      weightedDegree: weightedDegreeByTag.get(tag) || 0
    });
  }

  const topByCategory = new Map();

  for (const [category, tags] of tagsByCategory.entries()) {
    const topCount = Math.max(1, Math.ceil(tags.length * 0.05));

    const topTags = tags
      .sort((a, b) => {
        if (b.degree !== a.degree) return b.degree - a.degree;
        return b.weightedDegree - a.weightedDegree;
      })
      .slice(0, topCount);

    topByCategory.set(category, topTags);
  }

  return {
    categoryCounts,
    degreeByTag,
    weightedDegreeByTag,
    topByCategory
  };
}

function renderDataOverview() {
  const uniqueTags = Array.from(state.frequencyByTag.keys())
    .filter((tag) => tag && tag !== "N/A");

  const categoryCounts = new Map();

  uniqueTags.forEach((tag) => {
    const meta = state.metaByTag.get(tag);
    const category = meta ? meta.category : "unknown";

    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  });

  const categorySummary = Array.from(categoryCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => {
      return `
        <div class="overview-stat-card">
          <strong>${formatCategory(category)}</strong>
          <span>${count} tags</span>
        </div>
      `;
    })
    .join("");

  d3.select("#data-overview").html(`
    <div class="overview-note">
      Fixed summary based on the full dataset.
    </div>

    <h3>Dataset size</h3>
    <div class="overview-stat-grid">
      <div class="overview-stat-card">
        <strong>Works</strong>
        <span>${state.works.length}</span>
      </div>

      <div class="overview-stat-card">
        <strong>Tag records</strong>
        <span>${state.workTags.length}</span>
      </div>

      <div class="overview-stat-card">
        <strong>Unique tags</strong>
        <span>${uniqueTags.length}</span>
      </div>

      <div class="overview-stat-card">
        <strong>Categories</strong>
        <span>${categoryCounts.size}</span>
      </div>
    </div>

    <h3>Nodes by category</h3>
    <div class="overview-stat-grid">
      ${categorySummary}
    </div>
  `);
}

function setupHelpModal() {
  const helpButton = d3.select("#help-button");
  const helpModal = d3.select("#help-modal");
  const closeButton = d3.select("#close-help");

  if (helpButton.empty() || helpModal.empty() || closeButton.empty()) {
    return;
  }

  helpButton.on("click", function () {
    helpModal.classed("hidden", false);
  });

  closeButton.on("click", function () {
    helpModal.classed("hidden", true);
  });

  helpModal.on("click", function (event) {
    if (event.target === this) {
      helpModal.classed("hidden", true);
    }
  });

  d3.select("body").on("keydown.help", function (event) {
    if (event.key === "Escape") {
      helpModal.classed("hidden", true);
    }
  });
}
