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
  currentGraph: null
  fixedPositions: new Map(),
  compareTags: new Set(),
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

  d3.select("#hide-power")
    .on("change", function () {
      if (this.checked) {
        state.excludedTags.add("능력녀");
      } else {
        state.excludedTags.delete("능력녀");
      }

      updateNetwork();
    });

  setupCompareControls();
}

function setupCompareControls() {
  const tags = Array.from(state.frequencyByTag.keys()).sort();

  const selectA = d3.select("#compare-a");
  const selectB = d3.select("#compare-b");

  selectA
    .selectAll("option")
    .data(tags)
    .join("option")
    .attr("value", (d) => d)
    .text((d) => d);

  selectB
    .selectAll("option")
    .data(tags)
    .join("option")
    .attr("value", (d) => d)
    .text((d) => d);

  selectA.property("value", "걸크러쉬");
  selectB.property("value", "엉뚱발랄녀");

  d3.select("#compare-button")
    .on("click", compareSelectedTags);
}

function updateNetwork() {
  const graph = buildGraph();
  state.currentGraph = graph;
  drawNetwork(graph);

  d3.select("#data-status").html(`
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

  const nodes = graph.nodes.map((d) => ({ ...d }));
  const links = graph.links.map((d) => ({ ...d }));

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(90))
    .force("charge", d3.forceManyBody().strength(-170))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius((d) => nodeRadius(d) + 8));

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
    });

  node.append("circle")
    .attr("r", (d) => nodeRadius(d))
    .attr("fill", (d) => categoryColor(d.category));

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

function nodeRadius(d) {
  return 4 + Math.sqrt(d.frequency || 1) * 2;
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

    d.fx = null;
    d.fy = null;
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
    Frequency: ${node.frequency}<br><br>
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
  const tagA = d3.select("#compare-a").property("value");
  const tagB = d3.select("#compare-b").property("value");

  if (!tagA || !tagB || tagA === tagB) {
    d3.select("#compare-results").html("Choose two different tags.");
    return;
  }

  const graph = state.currentGraph;

  const weightMap = new Map();

  for (const link of graph.links) {
    const source = getLinkName(link.source);
    const target = getLinkName(link.target);
    weightMap.set(pairKey(source, target), link.weight);
  }

  const results = [];

  for (const node of graph.nodes) {
    const target = node.id;

    if (target === tagA || target === tagB) continue;

    const weightA = weightMap.get(pairKey(tagA, target)) || 0;
    const weightB = weightMap.get(pairKey(tagB, target)) || 0;

    if (weightA === 0 && weightB === 0) continue;

    results.push({
      tag: target,
      weightA,
      weightB,
      difference: Math.abs(weightA - weightB)
    });
  }

  const closerToA = results
    .filter((d) => d.weightA > d.weightB)
    .sort((a, b) => b.difference - a.difference)
    .slice(0, 8);

  const closerToB = results
    .filter((d) => d.weightB > d.weightA)
    .sort((a, b) => b.difference - a.difference)
    .slice(0, 8);

  const balanced = results
    .filter((d) => d.weightA === d.weightB && d.weightA > 0)
    .sort((a, b) => b.weightA - a.weightA)
    .slice(0, 8);

  d3.select("#compare-results").html(`
    <strong>${tagA} vs ${tagB}</strong>

    <div class="compare-group">
      <h4>Closer to ${tagA}</h4>
      <ul>
        ${closerToA.map((d) => `<li>${d.tag}: ${d.weightA} vs ${d.weightB}</li>`).join("") || "<li>No visible result</li>"}
      </ul>
    </div>

    <div class="compare-group">
      <h4>Shared or balanced</h4>
      <ul>
        ${balanced.map((d) => `<li>${d.tag}: ${d.weightA} vs ${d.weightB}</li>`).join("") || "<li>No visible result</li>"}
      </ul>
    </div>

    <div class="compare-group">
      <h4>Closer to ${tagB}</h4>
      <ul>
        ${closerToB.map((d) => `<li>${d.tag}: ${d.weightA} vs ${d.weightB}</li>`).join("") || "<li>No visible result</li>"}
      </ul>
    </div>
  `);
}
