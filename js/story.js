const storyState = {
  works: [],
  workTags: [],
  metadata: [],
  worksById: new Map(),
  metaByTag: new Map(),
  tagsByWork: new Map(),
  frequencyByTag: new Map(),
  tagLookup: new Map(),
  currentGraph: null,
  currentOptions: {
    preset: "intro",
    focusTags: new Set(),
    compareTags: new Set(),
    spotlightTags: new Set(),
    category: null
  }
};

const STORY_COLORS = {
  background: "#fbf8ef",
  text: "#1f1a14",
  muted: "#1f1a14",
  link: "#b7ad9a",
  node: "#625d55",
  focus: "#111111",
  compareA: "#111111",
  shared: "#9b7a44",
  gold: "#9b7a44",
  teal: "#557f7b"
};

const STORY_TEXT = {
  ko: {
    datasetView: "데이터셋 보기",
    works: "작품 수",
    uniqueTags: "고유 해시태그",
    visibleEdges: "표시된 연결",
    visibleNodes: "표시된 노드",
    frequency: "빈도",
    category: "카테고리",
    topLinksShown: "주요 연결",
    strongestConnections: "가장 강한 연결",
    comparison: "비교",
    comparedWithin: "비교 범위",
    sharedTopNodes: "공유 노드",
    sharedNeighboringTags: "공유 인접 태그",
    pinned: "고정됨",
    visibleLinks: "표시된 연결",
    interactionNote: "네트워크 안에서 확대/축소할 수 있습니다. 노드를 드래그하면 고정되고, 더블클릭하면 고정이 해제됩니다."
  },
  en: {
    datasetView: "Dataset view",
    works: "Works",
    uniqueTags: "Unique tags",
    visibleEdges: "Visible edges",
    visibleNodes: "Visible nodes",
    frequency: "Frequency",
    category: "Category",
    topLinksShown: "Top links shown",
    strongestConnections: "Strongest visible connections",
    comparison: "Comparison",
    comparedWithin: "Compared within",
    sharedTopNodes: "Shared top nodes",
    sharedNeighboringTags: "Shared neighboring tags",
    pinned: "Pinned",
    visibleLinks: "Visible links",
    interactionNote: "Scroll or pinch inside the network to zoom. Drag a node to pin it. Double-click a node to unpin it."
  }
};

function currentStoryLang() {
  return document.body.dataset.lang === "en" ? "en" : "ko";
}

function storyText(key) {
  return STORY_TEXT[currentStoryLang()][key] || STORY_TEXT.en[key] || key;
}

Promise.all([
  d3.csv("data/works.csv"),
  d3.csv("data/work_tags.csv"),
  d3.csv("data/tag_metadata.csv")
]).then(([works, workTags, metadata]) => {
  storyState.works = works;
  storyState.workTags = workTags;
  storyState.metadata = metadata;

  prepareStoryData();
  setupStoryScroll();

  const firstStep = document.querySelector(".story-step");
  if (firstStep) {
    firstStep.classList.add("active");
    applyStoryStep(firstStep);
  }
}).catch((error) => {
  console.error(error);
  d3.select("#story-inspector").html(
    "Failed to load CSV files. Check that data/works.csv, data/work_tags.csv, and data/tag_metadata.csv exist."
  );
});

function cleanTag(tag) {
  return String(tag || "").trim().replace(/^#/, "");
}

function cleanCategory(category) {
  return String(category || "").trim().toLowerCase().replace(/[\s/]+/g, "_");
}

function formatCategory(category) {
  if (!category) return "all categories";
  return String(category).replaceAll("_", " ");
}

function tagKey(value) {
  return cleanTag(value).replace(/\s+/g, "").toLowerCase();
}

function resolveStoryTag(value) {
  const tag = cleanTag(value);
  return storyState.tagLookup.get(tagKey(tag)) || tag;
}

function prepareStoryData() {
  storyState.worksById = new Map();
  storyState.metaByTag = new Map();
  storyState.tagsByWork = new Map();
  storyState.frequencyByTag = new Map();
  storyState.tagLookup = new Map();

  storyState.works.forEach((work) => {
    storyState.worksById.set(String(work.work_id), work);
  });

  storyState.metadata.forEach((row) => {
    const tag = cleanTag(row.tag);
    if (!tag || tag === "N/A") return;

    const category = cleanCategory(row.category);

    storyState.metaByTag.set(tag, {
      tag,
      category,
      description: row.description || ""
    });

    storyState.tagLookup.set(tagKey(tag), tag);
  });

  storyState.workTags.forEach((row) => {
    const workId = String(row.work_id);
    const tag = cleanTag(row.tag);

    if (!workId || !tag || tag === "N/A") return;

    storyState.tagLookup.set(tagKey(tag), tag);

    if (!storyState.tagsByWork.has(workId)) {
      storyState.tagsByWork.set(workId, new Set());
    }

    storyState.tagsByWork.get(workId).add(tag);
  });

  storyState.tagsByWork.forEach((tags) => {
    tags.forEach((tag) => {
      storyState.frequencyByTag.set(
        tag,
        (storyState.frequencyByTag.get(tag) || 0) + 1
      );
    });
  });
}

function setupStoryScroll() {
  const scrollRoot = document.querySelector(".story-text");
  const steps = Array.from(document.querySelectorAll(".story-step"));

  if (!steps.length) return;

  const observer = new IntersectionObserver((entries) => {
    const visibleEntries = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

    if (!visibleEntries.length) return;

    const activeStep = visibleEntries[0].target;

    steps.forEach((step) => {
      step.classList.remove("active");
    });

    activeStep.classList.add("active");
    applyStoryStep(activeStep);
  }, {
    root: scrollRoot || null,
    threshold: [0.2, 0.4, 0.6]
  });

  steps.forEach((step) => {
    observer.observe(step);
  });

  let resizeTimer = null;

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(() => {
      if (storyState.currentGraph) {
        drawStoryNetwork(storyState.currentGraph, storyState.currentOptions);
      }
    }, 150);
  });
}

function applyStoryStep(step) {
  const preset = step.dataset.preset || "intro";
  const category = step.dataset.category ? cleanCategory(step.dataset.category) : null;
  const tags = parseTags(step.dataset.tags);
  const focusTags = new Set(parseTags(step.dataset.focus));
  const spotlightTags = new Set(parseTags(step.dataset.spotlight));

  let graph;
  let options = {
    preset,
    focusTags,
    compareTags: new Set(),
    spotlightTags,
    category
  };

  if (preset === "compare") {
    const compareTags = new Set(tags);

    options.compareTags = compareTags;
    options.category = category;

    graph = buildStoryComparisonGraph(Array.from(compareTags), category);
  } else if (preset === "inspect") {
    tags.forEach((tag) => focusTags.add(tag));
    options.focusTags = focusTags;

    graph = buildStoryGraph({
      category: guessCategoryFromTags(tags),
      minFrequency: 1,
      minWeight: 1
    });
  } else if (preset === "category") {
    graph = buildStoryGraph({
      category,
      minFrequency: 1,
      minWeight: category ? 1 : 2
    });
  } else {
    graph = buildStoryGraph({
      category: null,
      minFrequency: 1,
      minWeight: 2
    });
  }

  storyState.currentGraph = graph;
  storyState.currentOptions = options;

  drawStoryNetwork(graph, options);
  updateStoryTextPanel(graph, options);
}

function parseTags(value) {
  if (!value) return [];

  return String(value)
    .split(/[|,]/)
    .map((tag) => resolveStoryTag(tag))
    .filter(Boolean);
}

function inferComparisonCategory(tags) {
  const categories = new Set();

  tags.forEach((tag) => {
    const meta = storyState.metaByTag.get(tag);
    if (meta && meta.category) {
      categories.add(meta.category);
    }
  });

  if (categories.size === 1) {
    return Array.from(categories)[0];
  }

  return null;
}

function guessCategoryFromTags(tags) {
  for (const tag of tags) {
    const meta = storyState.metaByTag.get(tag);
    if (meta && meta.category) return meta.category;
  }

  return null;
}

function buildStoryGraph({ category = null, minFrequency = 1, minWeight = 1 } = {}) {
  const selectedTags = new Set();

  storyState.frequencyByTag.forEach((frequency, tag) => {
    if (!tag || tag === "N/A") return;
    if (frequency < minFrequency) return;

    const meta = storyState.metaByTag.get(tag);
    if (category && (!meta || meta.category !== category)) return;

    selectedTags.add(tag);
  });

  const nodes = Array.from(selectedTags).map((tag) => {
    const meta = storyState.metaByTag.get(tag) || {};
    return {
      id: tag,
      label: tag,
      category: meta.category || "unknown",
      description: meta.description || "",
      frequency: storyState.frequencyByTag.get(tag) || 0
    };
  });

  const pairWeights = new Map();

  storyState.tagsByWork.forEach((tags) => {
    const filtered = Array.from(tags).filter((tag) => selectedTags.has(tag));

    for (let i = 0; i < filtered.length; i += 1) {
      for (let j = i + 1; j < filtered.length; j += 1) {
        const a = filtered[i];
        const b = filtered[j];
        const key = [a, b].sort().join("|||");

        pairWeights.set(key, (pairWeights.get(key) || 0) + 1);
      }
    }
  });

  const links = Array.from(pairWeights.entries())
    .map(([key, weight]) => {
      const [source, target] = key.split("|||");
      return { source, target, weight };
    })
    .filter((link) => link.weight >= minWeight);

  return {
    mode: "network",
    category,
    nodes,
    links
  };
}

function buildStoryComparisonGraph(compareTags, targetCategory = null) {
  const anchors = compareTags.filter(Boolean);
  const anchorSet = new Set(anchors);
  const targetWeights = new Map();

  anchors.forEach((anchor) => {
    targetWeights.set(anchor, new Map());
  });

  function isAllowedTarget(tag) {
    if (!tag || tag === "N/A") return false;

    if (anchorSet.has(tag)) return true;

    if (!targetCategory) return true;

    const meta = storyState.metaByTag.get(tag);
    return meta && meta.category === targetCategory;
  }

  storyState.tagsByWork.forEach((tags) => {
    anchors.forEach((anchor) => {
      if (!tags.has(anchor)) return;

      tags.forEach((target) => {
        if (target === anchor) return;
        if (!isAllowedTarget(target)) return;

        const anchorMap = targetWeights.get(anchor);
        anchorMap.set(target, (anchorMap.get(target) || 0) + 1);
      });
    });
  });

  const nodeIds = new Set(anchors);
  const links = [];

  anchors.forEach((anchor) => {
    const anchorMap = targetWeights.get(anchor);

    anchorMap.forEach((weight, target) => {
      nodeIds.add(target);

      links.push({
        source: anchor,
        target,
        weight
      });
    });
  });

  const nodes = Array.from(nodeIds).map((tag) => {
    const meta = storyState.metaByTag.get(tag) || {};

    const comparisonWeights = anchors.map((anchor) => ({
      selected: anchor,
      weight: targetWeights.get(anchor)?.get(tag) || 0
    }));

    const connected = comparisonWeights.filter((item) => item.weight > 0);

    let comparisonGroup = "unconnected";

    if (anchorSet.has(tag)) {
      comparisonGroup = "anchor";
    } else if (connected.length > 1) {
      comparisonGroup = "shared";
    } else if (connected.length === 1) {
      comparisonGroup = `only_${connected[0].selected}`;
    }

    return {
      id: tag,
      label: tag,
      category: meta.category || "unknown",
      description: meta.description || "",
      frequency: storyState.frequencyByTag.get(tag) || 0,
      comparisonWeights,
      comparisonGroup,
      comparisonTotalWeight: d3.sum(comparisonWeights, (d) => d.weight)
    };
  });

  return {
    mode: "comparison",
    compareTags: anchors,
    targetCategory,
    nodes,
    links
  };
}

function drawStoryNetwork(graph, options) {
  const svg = d3.select("#story-network");
  const nodeEl = svg.node();

  if (!nodeEl) return;

  const width = nodeEl.clientWidth || 900;
  const height = nodeEl.clientHeight || 660;

  svg.selectAll("*").remove();

  svg
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  if (!graph.nodes.length) {
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("text-anchor", "middle")
      .attr("fill", STORY_COLORS.text)
      .text("No nodes under this preset.");
    return;
  }

  const nodes = graph.nodes.map((d) => ({ ...d }));
  const links = graph.links.map((d) => ({ ...d }));

  const zoomLayer = svg.append("g")
    .attr("class", "story-zoom-layer");

  const linkLayer = zoomLayer.append("g")
    .attr("class", "story-links");

  const nodeLayer = zoomLayer.append("g")
    .attr("class", "story-nodes");

  const zoom = d3.zoom()
    .scaleExtent([0.35, 4])
    .translateExtent([
      [-width * 2, -height * 2],
      [width * 3, height * 3]
    ])
    .on("zoom", function (event) {
      zoomLayer.attr("transform", event.transform);
    });

  svg
    .call(zoom)
    .on("dblclick.zoom", null)
    .call(zoom.transform, d3.zoomIdentity);

  const maxWeight = d3.max(links, (d) => d.weight) || 1;

  const linkWidth = d3.scaleSqrt()
    .domain([1, maxWeight])
    .range([0.8, 7]);

  const link = linkLayer
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke", (d) => linkColor(d, graph, options))
    .attr("stroke-opacity", (d) => linkOpacity(d, options))
    .attr("stroke-width", (d) => linkWidth(d.weight));

  const node = nodeLayer
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "story-node");

  node.append("circle")
    .attr("r", (d) => storyNodeRadius(d, options))
    .attr("fill", (d) => storyNodeColor(d, options))
    .attr("stroke", (d) => storyNodeStroke(d, options))
    .attr("stroke-width", (d) => storyNodeStrokeWidth(d, options));

  node.append("text")
    .text((d) => d.label)
    .attr("x", (d) => storyNodeRadius(d, options) + 7)
    .attr("y", 4)
    .attr("font-size", (d) => isHighlighted(d, options) ? 15 : 12)
    .attr("font-weight", (d) => isHighlighted(d, options) ? 700 : 400)
    .attr("fill", STORY_COLORS.text);

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id)
      .distance((d) => graph.mode === "comparison" ? 170 : 125)
      .strength((d) => graph.mode === "comparison" ? 0.3 : 0.22))
    .force("charge", d3.forceManyBody().strength(graph.mode === "comparison" ? -320 : -280))
    .force("collide", d3.forceCollide().radius((d) => storyNodeRadius(d, options) + 18));

  if (graph.mode === "comparison") {
    simulation
      .force("x", d3.forceX((d) => comparisonX(d, graph, width)).strength(0.9))
      .force("y", d3.forceY((d) => comparisonY(d, graph, height)).strength(0.18));
  } else {
    simulation
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX(width / 2).strength(0.055))
      .force("y", d3.forceY(height / 2).strength(0.055));
  }

  node
    .call(storyDrag(simulation, nodeEl))
    .on("mouseenter", function (event, d) {
      d3.select(this).classed("hovered", true).raise();
      renderStoryHoverInspector(d, graph, options);
    })
    .on("mouseleave", function () {
      d3.select(this).classed("hovered", false);
      updateStoryTextPanel(graph, options);
    })
    .on("dblclick", function (event, d) {
      event.stopPropagation();

      d.fx = null;
      d.fy = null;
      d.pinned = false;

      d3.select(this).classed("pinned", false);

      simulation.alphaTarget(0.18).restart();

      setTimeout(() => {
        simulation.alphaTarget(0);
      }, 350);

      renderStoryHoverInspector(d, graph, options);
    });

  simulation.on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    node.attr("transform", (d) => {
      const padding = storyNodeRadius(d, options) + 18;

      d.x = Math.max(padding, Math.min(width - padding, d.x));
      d.y = Math.max(padding, Math.min(height - padding, d.y));

      return `translate(${d.x},${d.y})`;
    });
  });

  d3.select("#story-viz-title").text(visualTitle(graph, options));
}

function storyDrag(simulation, svgNode) {
  function graphPoint(event) {
    const transform = d3.zoomTransform(svgNode);
    const sourceEvent = event.sourceEvent || event;
    const [x, y] = d3.pointer(sourceEvent, svgNode);

    return transform.invert([x, y]);
  }

  return d3.drag()
    .on("start", function (event, d) {
      if (event.sourceEvent) {
        event.sourceEvent.stopPropagation();
      }

      const [x, y] = graphPoint(event);

      d.fx = x;
      d.fy = y;
      d.pinned = true;

      d3.select(this).classed("pinned", true);

      if (!event.active) {
        simulation.alphaTarget(0.25).restart();
      }
    })
    .on("drag", function (event, d) {
      const [x, y] = graphPoint(event);

      d.fx = x;
      d.fy = y;
      d.pinned = true;

      d3.select(this).classed("pinned", true);
    })
    .on("end", function (event, d) {
      const [x, y] = graphPoint(event);

      d.fx = x;
      d.fy = y;
      d.pinned = true;

      d3.select(this).classed("pinned", true);

      if (!event.active) {
        simulation.alphaTarget(0);
      }
    });
}

function renderStoryHoverInspector(node, graph, options) {
  const connections = graph.links
    .filter((link) => {
      const source = getLinkName(link.source);
      const target = getLinkName(link.target);

      return source === node.id || target === node.id;
    })
    .map((link) => {
      const source = getLinkName(link.source);
      const target = getLinkName(link.target);

      return {
        tag: source === node.id ? target : source,
        weight: link.weight
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  const comparisonInfo = node.comparisonWeights
    ? `
      <h4>Comparison weights</h4>
      <ol>
        ${
          node.comparisonWeights
            .map((item) => `<li><strong>${item.selected}</strong> <span>${item.weight}</span></li>`)
            .join("")
        }
      </ol>
    `
    : "";

  d3.select("#story-inspector").html(`
    <h3>${node.label}</h3>

    <div class="story-stat-grid">
      <div><strong>${node.frequency}</strong><span>Frequency</span></div>
      <div><strong>${connections.length}</strong><span>Visible links</span></div>
    </div>

    <p><strong>Category:</strong> ${formatCategory(node.category)}</p>
    <p><strong>Pinned:</strong> ${node.pinned ? "Yes" : "No"}</p>

    ${node.description ? `<p>${node.description}</p>` : ""}

    ${comparisonInfo}

    <h4>Strongest visible connections</h4>
    <ol>
      ${
        connections.length
          ? connections.map((d) => `<li><strong>${d.tag}</strong> <span>${d.weight}</span></li>`).join("")
          : "<li>No visible connections under this preset.</li>"
      }
    </ol>

    <p class="story-interaction-note">
      Scroll or pinch inside the network to zoom. Drag a node to pin it. Double-click a node to unpin it.
    </p>
  `);
}

function storyNodeRadius(d, options) {
  const base = 5 + Math.sqrt(d.frequency || 1) * 2.2;
  return isHighlighted(d, options) ? base + 4 : base;
}

function isHighlighted(d, options) {
  return (
    options.focusTags?.has(d.id) ||
    options.compareTags?.has(d.id) ||
    options.spotlightTags?.has(d.id)
  );
}

function storyNodeColor(d, options) {
  if (options.compareTags?.has(d.id)) return STORY_COLORS.focus;
  if (options.focusTags?.has(d.id)) return STORY_COLORS.focus;
  if (options.spotlightTags?.has(d.id)) return STORY_COLORS.gold;

  if (d.comparisonGroup === "shared") return STORY_COLORS.gold;
  if (String(d.comparisonGroup || "").startsWith("only_")) return "#8e8577";

  if (d.category === "female_protagonist") return "#5f6f85";
  if (d.category === "male_protagonist") return "#6b5648";
  if (d.category === "hybrid") return STORY_COLORS.teal;

  return STORY_COLORS.node;
}

function storyNodeStroke(d, options) {
  return isHighlighted(d, options) ? "#000000" : "#ffffff";
}

function storyNodeStrokeWidth(d, options) {
  return isHighlighted(d, options) ? 2.5 : 1;
}

function linkColor(d, graph, options) {
  const source = getLinkName(d.source);
  const target = getLinkName(d.target);

  if (options.compareTags?.has(source) || options.compareTags?.has(target)) {
    return STORY_COLORS.gold;
  }

  if (options.focusTags?.has(source) || options.focusTags?.has(target)) {
    return STORY_COLORS.focus;
  }

  return STORY_COLORS.link;
}

function linkOpacity(d, options) {
  const source = getLinkName(d.source);
  const target = getLinkName(d.target);

  if (
    options.focusTags?.has(source) ||
    options.focusTags?.has(target) ||
    options.compareTags?.has(source) ||
    options.compareTags?.has(target)
  ) {
    return 0.85;
  }

  return 0.45;
}

function comparisonX(d, graph, width) {
  const anchors = graph.compareTags || [];
  const margin = Math.min(160, width * 0.18);

  if (anchors.length <= 1) return width / 2;

  if (anchors.includes(d.id)) {
    const index = anchors.indexOf(d.id);
    return margin + (index / (anchors.length - 1)) * (width - margin * 2);
  }

  const weights = d.comparisonWeights || [];
  const total = d3.sum(weights, (item) => item.weight);

  if (!total) return width / 2;

  let weightedX = 0;

  weights.forEach((item) => {
    const index = anchors.indexOf(item.selected);
    if (index < 0) return;

    const anchorX = margin + (index / (anchors.length - 1)) * (width - margin * 2);
    weightedX += anchorX * item.weight;
  });

  return weightedX / total;
}

function comparisonY(d, graph, height) {
  if ((graph.compareTags || []).includes(d.id)) {
    return height * 0.34;
  }

  if (d.comparisonGroup === "shared") {
    return height * 0.52;
  }

  return height * 0.64;
}

function getLinkName(value) {
  if (typeof value === "string") return value;
  return value.id;
}

function visualTitle(graph, options) {
  if (graph.mode === "comparison") {
    return `Comparison: ${(graph.compareTags || []).join(" / ")}`;
  }

  if (options.preset === "inspect") {
    return `Inspector: ${Array.from(options.focusTags || []).join(", ")}`;
  }

  if (graph.category) {
    return `Category: ${formatCategory(graph.category)}`;
  }

  return "Full hashtag network";
}

function updateStoryTextPanel(graph, options) {
  if (graph.mode === "comparison") {
    renderComparisonPanel(graph, options);
    return;
  }

  if (options.focusTags && options.focusTags.size > 0) {
    const [tag] = Array.from(options.focusTags);
    renderTagInspector(tag, graph);
    return;
  }

  if (graph.category) {
    renderCategoryPanel(graph);
    return;
  }

  renderIntroPanel(graph);
}

function renderIntroPanel(graph) {
  const uniqueTags = Array.from(storyState.frequencyByTag.keys())
    .filter((tag) => tag && tag !== "N/A");

  d3.select("#story-inspector").html(`
    <h3>${storyText("datasetView")}</h3>
    <div class="story-stat-grid">
      <div><strong>${storyState.works.length}</strong><span>${storyText("works")}</span></div>
      <div><strong>${uniqueTags.length}</strong><span>${storyText("uniqueTags")}</span></div>
      <div><strong>${graph.links.length}</strong><span>${storyText("visibleEdges")}</span></div>
    </div>
  `);
}

function renderCategoryPanel(graph) {
  const topTags = graph.nodes
    .slice()
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 8);

  d3.select("#story-inspector").html(`
    <h3>${formatCategory(graph.category)}</h3>
    <p>${graph.nodes.length} visible tags in this category.</p>
    <h4>Most frequent tags</h4>
    <ol>
      ${topTags.map((d) => `<li><strong>${d.label}</strong> <span>${d.frequency}</span></li>`).join("")}
    </ol>
  `);
}

function renderTagInspector(tag, graph) {
  const node = graph.nodes.find((d) => d.id === tag);

  if (!node) {
    d3.select("#story-inspector").html(`
      <h3>${tag}</h3>
      <p>This tag is not visible under the current preset.</p>
    `);
    return;
  }

  const connections = graph.links
    .filter((link) => {
      const source = getLinkName(link.source);
      const target = getLinkName(link.target);
      return source === tag || target === tag;
    })
    .map((link) => {
      const source = getLinkName(link.source);
      const target = getLinkName(link.target);
      return {
        tag: source === tag ? target : source,
        weight: link.weight
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  d3.select("#story-inspector").html(`
    <h3>${node.label}</h3>
    <div class="story-stat-grid">
      <div><strong>${node.frequency}</strong><span>Frequency</span></div>
      <div><strong>${connections.length}</strong><span>Top links shown</span></div>
    </div>
    <p><strong>Category:</strong> ${formatCategory(node.category)}</p>
    ${node.description ? `<p>${node.description}</p>` : ""}
    <h4>Strongest visible connections</h4>
    <ol>
      ${
        connections.length
          ? connections.map((d) => `<li><strong>${d.tag}</strong> <span>${d.weight}</span></li>`).join("")
          : "<li>No visible connections under this preset.</li>"
      }
    </ol>
  `);
}

function renderComparisonPanel(graph, options) {
  const anchors = graph.compareTags || [];

  const shared = graph.nodes
    .filter((node) => node.comparisonGroup === "shared")
    .sort((a, b) => b.comparisonTotalWeight - a.comparisonTotalWeight)
    .slice(0, 8);

  const anchorStatus = anchors.map((tag) => {
    const exists = storyState.frequencyByTag.has(tag);
    return `${tag}${exists ? "" : " (not found)"}`;
  });

  d3.select("#story-inspector").html(`
    <h3>Comparison</h3>
    <p><strong>${anchorStatus.join(" / ")}</strong></p>
    ${
      graph.targetCategory
        ? `<p><strong>Compared within:</strong> ${formatCategory(graph.targetCategory)}</p>`
        : ""
    }
    <div class="story-stat-grid">
      <div><strong>${graph.nodes.length}</strong><span>Visible nodes</span></div>
      <div><strong>${graph.links.length}</strong><span>Visible edges</span></div>
      <div><strong>${shared.length}</strong><span>Shared top nodes</span></div>
    </div>
    <h4>Shared neighboring tags</h4>
    <ol>
      ${
        shared.length
          ? shared.map((d) => `<li><strong>${d.label}</strong> <span>${d.comparisonTotalWeight}</span></li>`).join("")
          : "<li>No shared neighboring tags under this preset.</li>"
      }
    </ol>
  `);
}

window.addEventListener("languagechange", () => {
  if (storyState.currentGraph) {
    updateStoryTextPanel(storyState.currentGraph, storyState.currentOptions);
  }
});
