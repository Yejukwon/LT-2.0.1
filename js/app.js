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
  fixedPositions: new Map(),
  viewMode: "full",
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
    setupControls();
    updateNetwork();
  })
  .catch((error) => {
    console.error(error);
    d3.select("#data-status").text("Failed to load CSV files. Check file paths and names.");
  });

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

function setupPinControls() {
  d3.select("#clear-all-pins").on("click", function () {
    state.fixedPositions.clear();
    updateNetwork();

    d3.select("#inspector").html(
      "All pinned node positions have been cleared."
    );
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

    if (!tag) return;

    state.compareTags.add(tag);
    renderCompareChips();
    updateNetwork();
    compareSelectedTags();
  });

  d3.select("#show-comparison-layout").on("click", function () {
    if (state.compareTags.size < 2) {
      d3.select("#compare-results").html(
        "Add at least two tags to use comparison layout."
      );
      return;
    }

    state.viewMode = "comparison";
    updateNetwork();
    compareSelectedTags();
  });

  d3.select("#clear-compare-tags").on("click", function () {
    state.compareTags.clear();
    state.viewMode = "full";

    renderCompareChips();
    updateNetwork();

    d3.select("#compare-results").html(
      "Add two or more tags to compare their co-occurrence patterns."
    );
  });

  updateCompareTagDropdown();
  renderCompareChips();
}

function updateCompareTagDropdown() {
  const selectedCategory = d3.select("#compare-category").property("value");

  const tags = Array.from(state.frequencyByTag.keys())
    .filter((tag) => {
      const meta = state.metaByTag.get(tag);
      return meta && meta.category === selectedCategory;
    })
    .sort();

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
      updateNetwork();
      compareSelectedTags();
    });
}

function updateNetwork() {
  const graph =
    state.viewMode === "comparison" && state.compareTags.size >= 2
      ? buildComparisonGraph()
      : buildGraph();

  state.currentGraph = graph;
  drawNetwork(graph);

  const modeLabel = graph.mode === "comparison" ? "Comparison layout" : "Full network";

  d3.select("#data-status").html(`
    <strong>${modeLabel}</strong><br>
    <strong>${graph.nodes.length}</strong> visible tags<br>
    <strong>${graph.links.length}</strong> visible links<br>
    <span class="small-note">Data source: works.csv, work_tags.csv, tag_metadata.csv</span>
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

      let comparisonGroup = "target";

      if (state.compareTags.has(tag)) {
        comparisonGroup = "anchor";
      } else if (connectedTo.length === 1) {
        comparisonGroup = "only_" + connectedTo[0].selected;
      } else if (connectedTo.length > 1) {
        comparisonGroup = "shared";
      }

      return {
        ...baseNode,
        comparisonGroup,
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

  if (graph.mode !== "comparison") {
    const fixed = state.fixedPositions.get(d.id);

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

  const simulation = d3.forceSimulation(nodes)
  .force("link", d3.forceLink(links).id((d) => d.id).distance((d) => {
    if (graph.mode === "comparison") return 180;
    return 90;
  }))
  .force("charge", d3.forceManyBody().strength((d) => {
    if (graph.mode === "comparison") return -260;
    return -170;
  }))
  .force("collision", d3.forceCollide().radius((d) => nodeRadius(d) + 10));

if (graph.mode === "comparison") {
  simulation
    .force("x", d3.forceX((d) => comparisonX(d, width)).strength(1.0))
    .force("y", d3.forceY((d) => comparisonY(d, height)).strength(0.12));
} else {
  simulation
    .force("center", d3.forceCenter(width / 2, height / 2));
}

  const link = graphLayer.append("g")
    .attr("class", "links")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "link")
    .attr("stroke", "#999")
    .attr("stroke-opacity", graph.mode === "comparison" ? 0.35 : 0.45)
    .attr("stroke-width", (d) => {
      if (graph.mode === "comparison") return 1 + Math.sqrt(d.weight);
      return Math.sqrt(d.weight);
    })
    .on("click", function (event, d) {
      event.stopPropagation();
      showEdgeInspector(d);
    });

  const node = graphLayer.append("g")
  .attr("class", "nodes")
  .selectAll("g")
  .data(nodes)
  .join("g")
  .attr("class", "node")
  .call(drag(simulation))
  .on("mouseenter", function (event, d) {
    showNodeInspector(d);
    showNodeTooltip(event, d);
  })
  .on("mousemove", function (event, d) {
    moveNodeTooltip(event);
  })
  .on("mouseleave", function () {
    hideNodeTooltip();
  })
  .on("dblclick", function (event, d) {
    event.stopPropagation();

    state.fixedPositions.delete(d.id);
    d.fx = null;
    d.fy = null;

    updateNetwork();
  });
  
  node.append("circle")
    .attr("r", (d) => {
      if (state.compareTags.has(d.id)) return nodeRadius(d) + 4;
      return nodeRadius(d);
    })
    .attr("fill", (d) => nodeColor(d))
    .attr("stroke", (d) => {
      if (state.compareTags.has(d.id)) return "#111111";
      if (state.fixedPositions.has(d.id)) return "#111111";
      return "#ffffff";
    })
    .attr("stroke-width", (d) => {
      if (state.compareTags.has(d.id)) return 3;
      if (state.fixedPositions.has(d.id)) return 3;
      return 1.5;
    });
  
  node.append("text")
    .text((d) => d.label)
    .attr("x", (d) => nodeRadius(d) + 6)
    .attr("y", 4)
    .attr("font-weight", (d) => state.compareTags.has(d.id) ? 700 : 400)
  .attr("fill", (d) => state.compareTags.has(d.id) ? "#111111" : "#333333");
  
  node.append("title")
    .text((d) => `${d.label} / ${formatCategory(d.category)} / frequency: ${d.frequency}`);

  simulation.on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    node
      .attr("transform", (d) => `translate(${d.x},${d.y})`);
  });
}

function comparisonX(d, width) {
  const selectedTags = state.currentGraph && state.currentGraph.compareTags
    ? state.currentGraph.compareTags
    : Array.from(state.compareTags);

  if (selectedTags.length === 0) return width * 0.5;

  const anchorPositions = new Map();

  selectedTags.forEach((tag, index) => {
    const x = width * (0.18 + (0.64 * index) / Math.max(1, selectedTags.length - 1));
    anchorPositions.set(tag, x);
  });

  if (state.compareTags.has(d.id)) {
    return anchorPositions.get(d.id) || width * 0.5;
  }

  if (!d.comparisonWeights || d.comparisonWeights.length === 0) {
    return width * 0.5;
  }

  const positiveWeights = d.comparisonWeights.filter((item) => item.weight > 0);

  if (positiveWeights.length === 1) {
    const selected = positiveWeights[0].selected;
    const anchorX = anchorPositions.get(selected) || width * 0.5;

    if (selectedTags.length === 2) {
      const index = selectedTags.indexOf(selected);
      return index === 0 ? anchorX + width * 0.10 : anchorX - width * 0.10;
    }

    return anchorX;
  }

  const total = d3.sum(positiveWeights, (item) => item.weight);

  if (total === 0) return width * 0.5;

  const weightedX = d3.sum(positiveWeights, (item) => {
    return (anchorPositions.get(item.selected) || width * 0.5) * item.weight;
  }) / total;

  return weightedX;
}

function comparisonY(d, height) {
  if (state.compareTags.has(d.id)) {
    return height * 0.5;
  }

  return height * 0.5;
}

function comparisonY(d, height) {
  if (d.comparisonGroup === "anchor_a") return height * 0.50;
  if (d.comparisonGroup === "anchor_b") return height * 0.50;

  return height * 0.50;
}

function nodeRadius(d) {
  return 4 + Math.sqrt(d.frequency || 1) * 2;
}

function nodeColor(d) {
  const graph = state.currentGraph;

  if (graph && graph.mode === "comparison") {
    const compareTags = new Set(graph.compareTags || Array.from(state.compareTags));

    if (compareTags.has(d.id)) {
      return "#111111";
    }

    if (d.comparisonGroup === "shared") {
      return "#b8b8b8";
    }

    if (String(d.comparisonGroup || "").startsWith("only_")) {
      return "#9a9a9a";
    }

    return "#d0d0d0";
  }

  if (state.compareTags.size > 0) {
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

function drag(simulation) {
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();

    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);

    d.fx = event.x;
    d.fy = event.y;

    state.fixedPositions.set(d.id, {
      x: event.x,
      y: event.y
    });

    showNodeInspector(d);
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
        <div><strong>Pinned</strong><br>${state.fixedPositions.has(node.id) ? "Yes" : "No"}</div>
      </div>

      ${
        node.comparisonGroup
          ? `<p><strong>Comparison group:</strong> ${node.comparisonGroup}</p>`
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
            ? connected.map((d) => `<li><strong>${d.tag}</strong>: ${d.weight}</li>`).join("")
            : "<li>No visible connections under the current filters.</li>"
        }
      </ol>

      <p class="small-note">Drag to pin. Double-click to unpin.</p>
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

function updateCompareTagDropdown() {
  const selectedCategory = d3.select("#compare-category").property("value");

  const tags = Array.from(state.frequencyByTag.keys())
    .filter((tag) => {
      const meta = state.metaByTag.get(tag);
      return meta && meta.category === selectedCategory;
    })
    .sort();

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
      updateNetwork();
      compareSelectedTags();
    });
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

  if (selectedTags.length < 2) {
    d3.select("#compare-results").html(
      "Add two or more tags to compare their co-occurrence patterns."
    );
    return;
  }

  const graph = state.currentGraph;
  const weightMap = new Map();

  for (const link of graph.links) {
    const source = getLinkName(link.source);
    const target = getLinkName(link.target);

    weightMap.set(pairKey(source, target), link.weight);
  }

  const candidates = graph.nodes
    .map((node) => node.id)
    .filter((tag) => !state.compareTags.has(tag));

  const rows = candidates.map((target) => {
    const weights = selectedTags.map((selected) => {
      return {
        selected,
        weight: weightMap.get(pairKey(selected, target)) || 0
      };
    });

    const total = d3.sum(weights, (d) => d.weight);
    const max = d3.max(weights, (d) => d.weight) || 0;
    const strongest = weights.filter((d) => d.weight === max && max > 0);

    return {
      target,
      weights,
      total,
      max,
      strongest
    };
  }).filter((d) => d.total > 0);

  const shared = rows
    .filter((row) => row.weights.every((d) => d.weight > 0))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const bySelectedTag = selectedTags.map((selected) => {
    const top = rows
      .filter((row) => {
        const selectedWeight = row.weights.find((d) => d.selected === selected).weight;
        return selectedWeight > 0 && row.strongest.some((d) => d.selected === selected);
      })
      .sort((a, b) => {
        const aw = a.weights.find((d) => d.selected === selected).weight;
        const bw = b.weights.find((d) => d.selected === selected).weight;
        return bw - aw;
      })
      .slice(0, 6);

    return { selected, top };
  });

  d3.select("#compare-results").html(`
    <strong>Comparison tags</strong><br>
    ${selectedTags.join(" / ")}

    <div class="compare-group">
      <h4>Shared by all selected tags</h4>
      <ul>
        ${
          shared.map((row) => {
            const values = row.weights.map((d) => `${d.selected}: ${d.weight}`).join(", ");
            return `<li>${row.target} <span class="small-note">(${values})</span></li>`;
          }).join("") || "<li>No visible shared result</li>"
        }
      </ul>
    </div>

    ${
      bySelectedTag.map((group) => `
        <div class="compare-group">
          <h4>Strongest near ${group.selected}</h4>
          <ul>
            ${
              group.top.map((row) => {
                const selectedWeight = row.weights.find((d) => d.selected === group.selected).weight;
                return `<li>${row.target}: ${selectedWeight}</li>`;
              }).join("") || "<li>No visible result</li>"
            }
          </ul>
        </div>
      `).join("")
    }
  `);
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
                <span>${item.selected}</span>
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
        node.comparisonGroup
          ? `Group: ${node.comparisonGroup}<br>`
          : ""
      }
      ${
        connected.length > 0
          ? `<br><strong>#Top links</strong><br>${connected.map((d) => `#${d.tag} (${d.weight})`).join("<br>")}`
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
