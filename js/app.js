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

  setupCompareControls();
}

function setupExcludeTagControl() {
  const tags = Array.from(state.frequencyByTag.keys())
    .filter((tag) => tag && tag !== "N/A")
    .sort();

  const select = d3.select("#exclude-tags");

  select
    .selectAll("option")
    .data(tags)
    .join("option")
    .attr("value", (d) => d)
    .text((d) => d);

  select.on("change", function () {
    const selected = Array.from(this.selectedOptions).map((option) => option.value);

    state.excludedTags = new Set(selected);

    updateNetwork();
  });

  d3.select("#clear-hidden-tags").on("click", function () {
    state.excludedTags.clear();

    select.selectAll("option").property("selected", false);

    updateNetwork();
  });
}

function setupCompareControls() {
  const categories = Array.from(
    new Set(state.metadata.map((d) => d.category))
  ).sort();

  const categorySelect = d3.select("#compare-category");
  const tagSelect = d3.select("#compare-tag");

  categorySelect
    .selectAll("option")
    .data(categories)
    .join("option")
    .attr("value", (d) => d)
    .text((d) => formatCategory(d));

  categorySelect.on("change", updateCompareTagDropdown);

  d3.select("#add-compare-tag").on("click", function () {
    const tag = tagSelect.property("value");

    if (tag) {
      state.compareTags.add(tag);
      renderCompareChips();
      updateNetwork();
      compareSelectedTags();
    }
  });

  d3.select("#clear-compare-tags").on("click", function () {
    state.compareTags.clear();
    renderCompareChips();
    updateNetwork();

    d3.select("#compare-results").html(
      "Add two or more tags to compare their co-occurrence patterns."
    );
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

  d3.select("#show-full-layout").on("click", function () {
    state.viewMode = "full";
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
  const selected = Array.from(state.compareTags).slice(0, 2);

  const tagA = selected[0];
  const tagB = selected[1];

  const nodeById = new Map(baseGraph.nodes.map((node) => [node.id, node]));

  const weightMap = new Map();

  for (const link of baseGraph.links) {
    const source = getLinkName(link.source);
    const target = getLinkName(link.target);

    weightMap.set(pairKey(source, target), link.weight);
  }

  const includedTags = new Set([tagA, tagB]);
  const groupByTag = new Map();

  groupByTag.set(tagA, "anchor_a");
  groupByTag.set(tagB, "anchor_b");

  for (const node of baseGraph.nodes) {
    const target = node.id;

    if (target === tagA || target === tagB) continue;

    const weightA = weightMap.get(pairKey(tagA, target)) || 0;
    const weightB = weightMap.get(pairKey(tagB, target)) || 0;

    if (weightA === 0 && weightB === 0) continue;

    includedTags.add(target);

    if (weightA > 0 && weightB > 0) {
      groupByTag.set(target, "shared");
    } else if (weightA > 0) {
      groupByTag.set(target, "a_only");
    } else if (weightB > 0) {
      groupByTag.set(target, "b_only");
    }
  }

  const nodes = Array.from(includedTags)
    .map((tag) => {
      const baseNode = nodeById.get(tag);

      if (!baseNode) return null;

      return {
        ...baseNode,
        comparisonGroup: groupByTag.get(tag),
        weightToA: weightMap.get(pairKey(tagA, tag)) || 0,
        weightToB: weightMap.get(pairKey(tagB, tag)) || 0
      };
    })
    .filter(Boolean);

  const links = baseGraph.links.filter((link) => {
    const source = getLinkName(link.source);
    const target = getLinkName(link.target);

    if (!includedTags.has(source) || !includedTags.has(target)) return false;

    const touchesA = source === tagA || target === tagA;
    const touchesB = source === tagB || target === tagB;

    return touchesA || touchesB;
  });

  return {
    mode: "comparison",
    compareTags: [tagA, tagB],
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
  const fixed = state.fixedPositions.get(d.id);

  if (fixed) {
    node.x = fixed.x;
    node.y = fixed.y;
    node.fx = fixed.x;
    node.fy = fixed.y;
  }

  return node;
});
  const links = graph.links.map((d) => ({ ...d }));

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
    .force("x", d3.forceX((d) => comparisonX(d, width)).strength(0.5))
    .force("y", d3.forceY((d) => comparisonY(d, height)).strength(0.08));
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
    .attr("stroke-opacity", 0.45)
    .attr("stroke-width", (d) => Math.sqrt(d.weight))
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
  .on("click", function (event, d) {
    event.stopPropagation();
    showNodeInspector(d);
  })
  .on("dblclick", function (event, d) {
    event.stopPropagation();

    state.fixedPositions.delete(d.id);
    d.fx = null;
    d.fy = null;

    updateNetwork();
  });

  node.append("circle")
    .attr("r", (d) => nodeRadius(d))
    .attr("fill", (d) => nodeColor(d))
    .attr("stroke", (d) => state.fixedPositions.has(d.id) ? "#111" : "#fff")
    .attr("stroke-width", (d) => state.fixedPositions.has(d.id) ? 3 : 1.5);

  node.append("text")
    .text((d) => d.label)
    .attr("x", (d) => nodeRadius(d) + 4)
    .attr("y", 4);

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
  if (d.comparisonGroup === "anchor_a") return width * 0.20;
  if (d.comparisonGroup === "a_only") return width * 0.28;
  if (d.comparisonGroup === "shared") return width * 0.50;
  if (d.comparisonGroup === "b_only") return width * 0.72;
  if (d.comparisonGroup === "anchor_b") return width * 0.80;

  return width * 0.50;
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
  if (state.currentGraph && state.currentGraph.mode === "comparison") {
    if (d.comparisonGroup === "anchor_a") return "#111111";
    if (d.comparisonGroup === "anchor_b") return "#111111";

    if (d.comparisonGroup === "a_only") return "#7a7a7a";
    if (d.comparisonGroup === "shared") return "#b8b8b8";
    if (d.comparisonGroup === "b_only") return "#7a7a7a";

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
    .slice(0, 12);

  d3.select("#inspector").html(`
    <strong>${node.label}</strong><br>
    Category: ${formatCategory(node.category)}<br>
    Frequency: ${node.frequency}<br>

    ${node.comparisonGroup ? `Comparison group: ${node.comparisonGroup}<br>` : ""}
    ${node.weightToA !== undefined ? `Weight to A: ${node.weightToA}<br>` : ""}
    ${node.weightToB !== undefined ? `Weight to B: ${node.weightToB}<br>` : ""}

    Pinned: ${state.fixedPositions.has(node.id) ? "Yes" : "No"}<br>
    <span class="pinned-note">Drag to pin. Double-click to unpin.</span><br><br>

    ${node.description ? `<p>${node.description}</p>` : ""}
    <strong>Top connections</strong>
    <ol class="inspector-list">
      ${connected.map((d) => `<li>${d.tag}: ${d.weight}</li>`).join("")}
    </ol>
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
