/* ============================================================
   QUIZ BUILDER — script.js stable v4
   ============================================================ */
"use strict";

let quizData = [];
let activeQuiz = [];
let activeEditorId = null;
let savedSelection = null;
let currentBuilderPage = 0;
let feedbackVisible = false;
let allFeedbackVisible = false;
let htmlEditorOpen = false;
let htmlEditorFieldId = null;

function getFilename() {
  const raw = document.getElementById("quizFilename").value.trim();
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_") || "quiz";
}

function editorLabel(id) {
  if (id === "quizTitle") return "Quiz title";
  if (id.startsWith("question_")) return `Question ${id.split("_")[1]}`;
  if (id.includes("_answer_")) return `Question ${id.match(/q(\d+)/)[1]} answer ${id.split("_").pop()}`;
  if (id.includes("_feedback")) return `Question ${id.match(/q(\d+)/)[1]} feedback`;
  return "Selected text field";
}

const FORMAT_COMMANDS = [
  "bold",
  "italic",
  "underline",
  "superscript",
  "subscript",
  "insertUnorderedList",
  "insertOrderedList"
];

const HTML_BLOCK_TAGS = new Set([
  "P", "DIV", "UL", "OL", "LI", "BLOCKQUOTE", "PRE",
  "H1", "H2", "H3", "H4", "H5", "H6", "TABLE"
]);

const LINE_SPACING_VALUES = new Set(["1", "1.15", "1.5", "2"]);
const DEFAULT_LINE_SPACING = "1";
const LINE_SPACING_ATTRIBUTE = "data-qb-line-spacing";

function normaliseLineSpacing(value) {
  const spacing = String(value || DEFAULT_LINE_SPACING);
  return LINE_SPACING_VALUES.has(spacing) ? spacing : DEFAULT_LINE_SPACING;
}

function applyEditorLineSpacing(editor, value) {
  if (!editor) return;
  const spacing = normaliseLineSpacing(value);
  editor.dataset.lineSpacing = spacing;
  editor.style.lineHeight = spacing;
}

function getEditorLineSpacing(editor) {
  return normaliseLineSpacing(editor?.dataset?.lineSpacing || DEFAULT_LINE_SPACING);
}

function ensureEditorLineSpacing(editor) {
  if (!editor) return;
  applyEditorLineSpacing(editor, getEditorLineSpacing(editor));
}

function registerEditable(editor) {
  ensureEditorLineSpacing(editor);
  updateEditorOverflowState(editor);
  editor.addEventListener("focus", () => setActiveEditor(editor.id));
  editor.addEventListener("mouseup", () => {
    saveActiveSelection();
    updateToolbarState();
  });
  editor.addEventListener("keyup", () => {
    saveActiveSelection();
    updateToolbarState();
  });
  editor.addEventListener("input", () => {
    handleEditorInput(editor.id);
    saveActiveSelection();
    updateToolbarState();
  });
}

function setActiveEditor(id) {
  if (htmlEditorOpen && htmlEditorFieldId && htmlEditorFieldId !== id) {
    commitSharedHtmlEditor();
  }

  activeEditorId = id;
  document.getElementById("activeFieldLabel").textContent = editorLabel(id);
  document.getElementById("sharedToolbar").classList.remove("inactive");
  saveActiveSelection();

  if (htmlEditorOpen) loadSharedHtmlEditor(id);
  updateToolbarState();
}

function getActiveRange() {
  if (!activeEditorId) return null;
  const editor = document.getElementById(activeEditorId);
  if (!editor) return null;

  const selection = window.getSelection();
  if (selection && selection.rangeCount) {
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) return range;
  }

  if (savedSelection && editor.contains(savedSelection.commonAncestorContainer)) {
    return savedSelection;
  }

  return null;
}

function saveActiveSelection() {
  if (!activeEditorId) return;
  const selection = window.getSelection();
  const editor = document.getElementById(activeEditorId);
  if (!selection || !selection.rangeCount || !editor) return;
  const range = selection.getRangeAt(0);
  if (editor.contains(range.commonAncestorContainer)) savedSelection = range.cloneRange();
}

function restoreSelection() {
  if (!activeEditorId || !savedSelection) return false;
  const editor = document.getElementById(activeEditorId);
  if (!editor || !editor.contains(savedSelection.commonAncestorContainer)) return false;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedSelection);
  return true;
}

function firstTextDescendant(node) {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node;
  for (const child of node.childNodes) {
    const text = firstTextDescendant(child);
    if (text) return text;
  }
  return null;
}

function lastTextDescendant(node) {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node;
  for (let index = node.childNodes.length - 1; index >= 0; index--) {
    const text = lastTextDescendant(node.childNodes[index]);
    if (text) return text;
  }
  return null;
}

function normaliseRangeToText(range, editor) {
  if (!range || range.collapsed) return range;
  const normalised = range.cloneRange();

  if (normalised.startContainer.nodeType === Node.ELEMENT_NODE) {
    const container = normalised.startContainer;
    const candidate = container.childNodes[normalised.startOffset] || container;
    const text = firstTextDescendant(candidate);
    if (text && editor.contains(text)) normalised.setStart(text, 0);
  }

  if (normalised.endContainer.nodeType === Node.ELEMENT_NODE) {
    const container = normalised.endContainer;
    const candidate = normalised.endOffset > 0
      ? container.childNodes[normalised.endOffset - 1]
      : container;
    const text = lastTextDescendant(candidate);
    if (text && editor.contains(text)) normalised.setEnd(text, text.textContent.length);
  }

  return normalised;
}

function applyNormalisedSelection(editor) {
  const range = getActiveRange();
  if (!range) return null;
  const normalised = normaliseRangeToText(range, editor);
  if (normalised !== range || !range.collapsed) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(normalised);
    savedSelection = normalised.cloneRange();
  }
  return normalised;
}

function selectedTextNodes(editor, suppliedRange = null) {
  const range = suppliedRange || getActiveRange();
  if (!range || range.collapsed) return [];

  const nodes = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.textContent.trim()) continue;
    try {
      if (range.intersectsNode(node)) nodes.push(node);
    } catch (_) {
      // Ignore detached nodes while the user is actively editing.
    }
  }
  return nodes;
}

function selectedFontSizes(editor) {
  const sizes = new Set();
  selectedTextNodes(editor).forEach(node => {
    const parent = node.parentElement || editor;
    const size = Number.parseFloat(getComputedStyle(parent).fontSize);
    if (Number.isFinite(size)) sizes.add(Number(size.toFixed(2)));
  });
  return [...sizes];
}

function getFormatElement() {
  const editor = activeEditorId ? document.getElementById(activeEditorId) : null;
  if (!editor) return null;
  const range = getActiveRange();
  const firstSelectedText = selectedTextNodes(editor, range)[0];
  let node = firstSelectedText || (range ? range.startContainer : editor);
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!(node instanceof Element) || !editor.contains(node)) return editor;
  return node;
}

function hasAncestorTag(element, tags) {
  const editor = activeEditorId ? document.getElementById(activeEditorId) : null;
  let current = element;
  while (current && current !== editor) {
    if (tags.includes(current.tagName)) return true;
    current = current.parentElement;
  }
  return false;
}

function inlineFormatOverride(element, command, editor) {
  let current = element;
  while (current && current !== editor) {
    if (command === "bold" && current.style.fontWeight) {
      const value = current.style.fontWeight.trim().toLowerCase();
      const numeric = Number.parseInt(value, 10);
      if (Number.isFinite(numeric)) return numeric >= 600;
      if (value === "bold" || value === "bolder") return true;
      if (value === "normal" || value === "lighter") return false;
    }

    if (command === "italic" && current.style.fontStyle) {
      const value = current.style.fontStyle.trim().toLowerCase();
      if (value === "italic" || value === "oblique") return true;
      if (value === "normal") return false;
    }

    if (command === "underline" && current.style.textDecoration) {
      const value = current.style.textDecoration.toLowerCase();
      if (value.includes("underline")) return true;
      if (value.includes("none") && current.style.display === "inline-block") return false;
    }

    current = current.parentElement;
  }
  return null;
}

function nodeHasFormat(node, command, editor) {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!(element instanceof Element)) return false;
  const style = getComputedStyle(element);

  const hasTag = tags => {
    let current = element;
    while (current && current !== editor) {
      if (tags.includes(current.tagName)) return true;
      current = current.parentElement;
    }
    return false;
  };

  const inlineOverride = inlineFormatOverride(element, command, editor);
  if (inlineOverride !== null) return inlineOverride;

  switch (command) {
    case "bold": {
      const numericWeight = Number.parseInt(style.fontWeight, 10);
      return hasTag(["B", "STRONG"]) ||
        (Number.isFinite(numericWeight)
          ? numericWeight >= 600
          : style.fontWeight === "bold" || style.fontWeight === "bolder");
    }
    case "italic":
      return hasTag(["I", "EM"]) ||
        style.fontStyle === "italic" || style.fontStyle === "oblique";
    case "underline":
      return hasTag(["U"]) || style.textDecorationLine.includes("underline");
    case "superscript":
      return hasTag(["SUP"]);
    case "subscript":
      return hasTag(["SUB"]);
    case "insertUnorderedList":
      return hasTag(["UL"]);
    case "insertOrderedList":
      return hasTag(["OL"]);
    default:
      return false;
  }
}

function isFormatActive(command) {
  const editor = activeEditorId ? document.getElementById(activeEditorId) : null;
  if (!editor) return false;

  const range = getActiveRange();
  const selectedNodes = selectedTextNodes(editor, range);
  if (selectedNodes.length) {
    return selectedNodes.every(node => nodeHasFormat(node, command, editor));
  }

  const element = getFormatElement();
  return element ? nodeHasFormat(element, command, editor) : false;
}

function updateFontSizeControl() {
  const control = document.getElementById("fontSizeControl");
  if (!control) return;
  const defaultOption = control.options[0];
  defaultOption.textContent = "Size";

  if (!activeEditorId) {
    control.value = "";
    return;
  }

  const editor = document.getElementById(activeEditorId);
  const element = getFormatElement() || editor;
  if (!element || !editor) {
    control.value = "";
    return;
  }

  const selectedSizes = selectedFontSizes(editor);
  if (selectedSizes.length > 1) {
    control.value = "";
    defaultOption.textContent = "Mixed";
    return;
  }

  const size = selectedSizes.length === 1
    ? selectedSizes[0]
    : Number.parseFloat(getComputedStyle(element).fontSize);
  const matchingOption = [...control.options].slice(1).find(option =>
    Math.abs(Number.parseFloat(option.value) - size) < 0.08
  );

  if (matchingOption) {
    control.value = matchingOption.value;
  } else if (Number.isFinite(size)) {
    control.value = "";
    defaultOption.textContent = `${Number(size.toFixed(2))}`;
  } else {
    control.value = "";
  }
}

function updateToolbarState() {
  const toolbar = document.getElementById("sharedToolbar");
  if (!toolbar) return;

  FORMAT_COMMANDS.forEach(command => {
    const button = toolbar.querySelector(`[data-command="${command}"]`);
    if (!button) return;
    const active = Boolean(activeEditorId) && isFormatActive(command);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const htmlButton = document.getElementById("htmlModeButton");
  if (htmlButton) {
    htmlButton.classList.toggle("is-active", htmlEditorOpen);
    htmlButton.setAttribute("aria-expanded", String(htmlEditorOpen));
    htmlButton.setAttribute("aria-pressed", String(htmlEditorOpen));
  }

  updateFontSizeControl();
  updateLineSpacingControl();
}

function updateLineSpacingControl() {
  const control = document.getElementById("lineSpacingControl");
  if (!control) return;
  if (!activeEditorId) {
    control.value = DEFAULT_LINE_SPACING;
    return;
  }
  const editor = document.getElementById(activeEditorId);
  control.value = editor ? getEditorLineSpacing(editor) : DEFAULT_LINE_SPACING;
}

function focusAndRestoreEditor() {
  if (!activeEditorId) return null;
  const editor = document.getElementById(activeEditorId);
  if (!editor) return null;

  const selectionToRestore = savedSelection && editor.contains(savedSelection.commonAncestorContainer)
    ? savedSelection.cloneRange()
    : null;

  editor.focus({ preventScroll: true });

  if (selectionToRestore) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(selectionToRestore);
    savedSelection = selectionToRestore.cloneRange();
  }

  return editor;
}

function wrapSelectionWithStyle(editor, property, value, transformFragment = null) {
  const range = applyNormalisedSelection(editor);
  if (!range || range.collapsed) return false;

  const fragment = range.extractContents();
  if (typeof transformFragment === "function") transformFragment(fragment);

  const wrapper = document.createElement("span");
  wrapper.style[property] = value;
  wrapper.appendChild(fragment);
  range.insertNode(wrapper);

  const firstText = firstTextDescendant(wrapper);
  const lastText = lastTextDescendant(wrapper);
  const nextRange = document.createRange();
  if (firstText && lastText) {
    nextRange.setStart(firstText, 0);
    nextRange.setEnd(lastText, lastText.textContent.length);
  } else {
    nextRange.selectNodeContents(wrapper);
  }

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(nextRange);
  savedSelection = nextRange.cloneRange();
  return wrapper;
}

function neutraliseInlineFormat(fragment, command, baseWeight) {
  const semanticTags = command === "bold"
    ? ["b", "strong"]
    : command === "italic"
      ? ["i", "em"]
      : ["u"];

  fragment.querySelectorAll(semanticTags.join(",")).forEach(element => {
    const span = document.createElement("span");
    [...element.attributes].forEach(attribute => {
      if (attribute.name !== "style") span.setAttribute(attribute.name, attribute.value);
    });
    span.style.cssText = element.style.cssText;
    while (element.firstChild) span.appendChild(element.firstChild);
    element.replaceWith(span);
  });

  fragment.querySelectorAll("*").forEach(element => {
    if (command === "bold") {
      element.style.setProperty("font-weight", baseWeight, "important");
    } else if (command === "italic") {
      element.style.setProperty("font-style", "normal", "important");
    } else {
      element.style.setProperty("text-decoration", "none", "important");
      element.style.display = "inline-block";
    }
  });
}

function removeCoveredFormattingAncestors(wrapper, command, editor, baseWeight) {
  const semanticTags = command === "bold"
    ? ["B", "STRONG"]
    : command === "italic"
      ? ["I", "EM"]
      : ["U"];

  let ancestor = wrapper.parentElement;
  while (ancestor && ancestor !== editor) {
    const parent = ancestor.parentElement;
    const coversOnlySelection = ancestor.textContent === wrapper.textContent;
    if (!coversOnlySelection) break;

    const semanticMatch = semanticTags.includes(ancestor.tagName);
    const inlineMatch = command === "bold"
      ? Boolean(ancestor.style.fontWeight)
      : command === "italic"
        ? Boolean(ancestor.style.fontStyle)
        : Boolean(ancestor.style.textDecoration);

    if (semanticMatch) {
      ancestor.replaceWith(...ancestor.childNodes);
    } else if (inlineMatch) {
      if (command === "bold") ancestor.style.setProperty("font-weight", baseWeight, "important");
      else if (command === "italic") ancestor.style.setProperty("font-style", "normal", "important");
      else ancestor.style.setProperty("text-decoration", "none", "important");
    }

    ancestor = parent;
  }

  if (command === "underline" && !hasAncestorTag(wrapper, ["U"])) {
    wrapper.style.display = "inline";
  }
}

function toggleInlineStyle(editor, command) {
  if (!["bold", "italic", "underline"].includes(command)) return false;
  const currentlyActive = isFormatActive(command);
  const baseWeight = getComputedStyle(editor).fontWeight || "normal";
  const neutralise = currentlyActive
    ? fragment => neutraliseInlineFormat(fragment, command, baseWeight)
    : null;

  let wrapper;
  if (command === "bold") {
    wrapper = wrapSelectionWithStyle(editor, "fontWeight", currentlyActive ? baseWeight : "700", neutralise);
    if (currentlyActive && wrapper) wrapper.style.setProperty("font-weight", baseWeight, "important");
  } else if (command === "italic") {
    wrapper = wrapSelectionWithStyle(editor, "fontStyle", currentlyActive ? "normal" : "italic", neutralise);
    if (currentlyActive && wrapper) wrapper.style.setProperty("font-style", "normal", "important");
  } else {
    wrapper = wrapSelectionWithStyle(editor, "textDecoration", currentlyActive ? "none" : "underline", neutralise);
    if (currentlyActive && wrapper) {
      wrapper.style.setProperty("text-decoration", "none", "important");
      wrapper.style.display = "inline-block";
    }
  }

  if (currentlyActive && wrapper) {
    removeCoveredFormattingAncestors(wrapper, command, editor, baseWeight);
  }
  return Boolean(wrapper);
}

function formatActiveText(command) {
  if (!activeEditorId || !FORMAT_COMMANDS.includes(command)) return;
  const editor = focusAndRestoreEditor();
  if (!editor) return;
  applyNormalisedSelection(editor);

  const handledInlineStyle = toggleInlineStyle(editor, command);
  if (!handledInlineStyle) document.execCommand(command, false, null);
  handleEditorInput(activeEditorId);
  saveActiveSelection();
  updateToolbarState();
}

function formatActiveFontSize(size) {
  if (!activeEditorId || !size) {
    updateFontSizeControl();
    return;
  }

  const editor = focusAndRestoreEditor();
  if (!editor) return;
  const selection = window.getSelection();
  let range = applyNormalisedSelection(editor);

  if (!range || (range.collapsed && editor.textContent.trim())) {
    range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    savedSelection = range.cloneRange();
  }

  wrapSelectionWithStyle(editor, "fontSize", `${Number(size)}px`);
  handleEditorInput(activeEditorId);
  saveActiveSelection();
  updateToolbarState();
}

function formatActiveLineSpacing(value) {
  if (!activeEditorId) {
    updateLineSpacingControl();
    return;
  }

  const editor = document.getElementById(activeEditorId);
  if (!editor) return;
  applyEditorLineSpacing(editor, value);
  updateEditorOverflowState(editor);
  scheduleAutosave();
  updateToolbarState();
}

function insertActiveSymbol(symbol) {
  const control = document.getElementById("symbolControl");
  if (!activeEditorId || !symbol) {
    control.selectedIndex = 0;
    return;
  }

  const editor = focusAndRestoreEditor();
  if (!editor) return;
  document.execCommand("insertText", false, symbol);
  control.selectedIndex = 0;
  handleEditorInput(activeEditorId);
  saveActiveSelection();
  updateToolbarState();
}

function normaliseHtmlForField(id, html) {
  const value = String(html || "").trim();
  if (!value || id === "quizTitle") return value;

  const source = document.createElement("div");
  source.innerHTML = value;
  const output = document.createElement("div");
  let paragraph = null;

  const startParagraph = () => {
    if (!paragraph) {
      paragraph = document.createElement("p");
      output.appendChild(paragraph);
    }
    return paragraph;
  };

  [...source.childNodes].forEach(node => {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
      if (paragraph) paragraph.appendChild(node.cloneNode(true));
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName;
      if (tag === "P") {
        paragraph = null;
        output.appendChild(node.cloneNode(true));
        return;
      }
      if (tag === "DIV") {
        paragraph = null;
        const replacement = document.createElement("p");
        [...node.attributes].forEach(attribute =>
          replacement.setAttribute(attribute.name, attribute.value)
        );
        replacement.innerHTML = node.innerHTML;
        output.appendChild(replacement);
        return;
      }
      if (HTML_BLOCK_TAGS.has(tag)) {
        paragraph = null;
        output.appendChild(node.cloneNode(true));
        return;
      }
    }

    startParagraph().appendChild(node.cloneNode(true));
  });

  return output.innerHTML;
}

function commitSharedHtmlEditor() {
  if (!htmlEditorOpen || !htmlEditorFieldId) return;
  const raw = document.getElementById("sharedHtmlEditor");
  const visual = document.getElementById(htmlEditorFieldId);
  if (!raw || !visual) return;
  visual.innerHTML = raw.value;
  updateEditorOverflowState(visual);
  scheduleAutosave();
}

function loadSharedHtmlEditor(id) {
  const visual = document.getElementById(id);
  const raw = document.getElementById("sharedHtmlEditor");
  const label = document.getElementById("htmlEditorFieldLabel");
  if (!visual || !raw || !label) return;

  const normalised = normaliseHtmlForField(id, visual.innerHTML);
  if (visual.innerHTML !== normalised) {
    visual.innerHTML = normalised;
    scheduleAutosave();
  }

  htmlEditorFieldId = id;
  raw.value = normalised;
  label.textContent = editorLabel(id);
}

function openHtmlEditorPanel(id) {
  if (!id) return;
  const panel = document.getElementById("htmlEditorPanel");
  const workbench = document.getElementById("canvasWorkbench");
  const raw = document.getElementById("sharedHtmlEditor");
  if (!panel || !workbench || !raw) return;

  htmlEditorOpen = true;
  workbench.classList.add("html-open");
  panel.setAttribute("aria-hidden", "false");
  loadSharedHtmlEditor(id);
  updateToolbarState();
  resizeBuilderCanvas();
  raw.focus({ preventScroll: true });
}

function closeHtmlEditorPanel(commit = true) {
  if (!htmlEditorOpen) return;
  if (commit) commitSharedHtmlEditor();

  const panel = document.getElementById("htmlEditorPanel");
  const workbench = document.getElementById("canvasWorkbench");
  if (panel) panel.setAttribute("aria-hidden", "true");
  if (workbench) workbench.classList.remove("html-open");

  htmlEditorOpen = false;
  htmlEditorFieldId = null;
  updateToolbarState();
  resizeBuilderCanvas();

  const editor = activeEditorId ? document.getElementById(activeEditorId) : null;
  if (editor) editor.focus({ preventScroll: true });
}

function handleSharedHtmlInput() {
  if (!htmlEditorOpen || !htmlEditorFieldId) return;
  commitSharedHtmlEditor();
}

function toggleActiveHtmlMode() {
  if (!activeEditorId) return;
  if (htmlEditorOpen) closeHtmlEditorPanel();
  else openHtmlEditorPanel(activeEditorId);
}

function toggleHtmlMode(id) {
  if (htmlEditorOpen && htmlEditorFieldId === id) closeHtmlEditorPanel();
  else openHtmlEditorPanel(id);
}

function syncHtmlModeToEditor(id) {
  if (htmlEditorOpen && htmlEditorFieldId === id) commitSharedHtmlEditor();
}

function parseStoredEditorHtml(value) {
  const html = String(value || "");
  const host = document.createElement("div");
  host.innerHTML = html;
  const meaningful = [...host.childNodes].filter(node =>
    node.nodeType !== Node.TEXT_NODE || node.textContent.trim()
  );

  if (meaningful.length === 1 && meaningful[0].nodeType === Node.ELEMENT_NODE) {
    const wrapper = meaningful[0];
    if (wrapper.hasAttribute(LINE_SPACING_ATTRIBUTE)) {
      return {
        html: wrapper.innerHTML,
        lineSpacing: normaliseLineSpacing(wrapper.getAttribute(LINE_SPACING_ATTRIBUTE))
      };
    }
  }

  return { html, lineSpacing: DEFAULT_LINE_SPACING };
}

function getHtml(id) {
  syncHtmlModeToEditor(id);
  const editor = document.getElementById(id);
  if (!editor) return "";
  if (!editor.innerHTML.trim()) return "";
  const spacing = getEditorLineSpacing(editor);
  return `<div ${LINE_SPACING_ATTRIBUTE}="${spacing}" style="line-height:${spacing}">${editor.innerHTML}</div>`;
}

function setHtml(id, value) {
  const editor = document.getElementById(id);
  if (!editor) return;
  const stored = parseStoredEditorHtml(value);
  editor.innerHTML = stored.html;
  applyEditorLineSpacing(editor, stored.lineSpacing);
  updateEditorOverflowState(editor);
  if (htmlEditorOpen && htmlEditorFieldId === id) {
    const raw = document.getElementById("sharedHtmlEditor");
    if (raw) raw.value = editor.innerHTML;
  }
}

function getText(id) {
  syncHtmlModeToEditor(id);
  const editor = document.getElementById(id);
  return editor ? editor.textContent.trim() : "";
}

function handleEditorInput(id) {
  if (htmlEditorOpen && htmlEditorFieldId === id) {
    const raw = document.getElementById("sharedHtmlEditor");
    const visual = document.getElementById(id);
    if (raw && visual && document.activeElement !== raw) raw.value = visual.innerHTML;
  }
  const editor = document.getElementById(id);
  if (editor) updateEditorOverflowState(editor);
  scheduleAutosave();
}

function editable(id, className, placeholder) {
  return `<div id="${id}" class="editable ${className}" contenteditable="true" data-placeholder="${placeholder}" data-line-spacing="1" style="line-height:1"></div>`;
}

function learnerMeasurementProfile(editor) {
  if (!editor) return null;
  if (editor.id === "quizTitle") {
    return { width: 483, height: 236, padding: "0", fontSize: "40px", fontWeight: "500", textAlign: "center" };
  }
  if (editor.classList.contains("question-editable")) {
    return { width: 426, height: 140, padding: "5px 15px", fontSize: "14.67px", fontWeight: "300", textAlign: "left" };
  }
  if (editor.classList.contains("answer-inner")) {
    // Learner answer card: 426 px wide, with 25 px left padding, a 30 px radio,
    // an 18 px gap and 10 px right padding. That leaves 343 px for answer text.
    return { width: 343, height: 60, padding: "0", fontSize: "13.33px", fontWeight: "300", textAlign: "left" };
  }
  if (editor.classList.contains("feedback-editable")) {
    return { width: 188, height: 250, padding: "0", fontSize: "14px", fontWeight: "300", textAlign: "left" };
  }
  return null;
}

function measurementHostForEditor(editor) {
  if (!editor) return null;
  const profile = learnerMeasurementProfile(editor);
  if (!profile) return null;

  // Measure against the learner dimensions rather than the live contenteditable.
  // Native scrollbars can take horizontal space in the builder and create a
  // feedback loop where a tiny overflow causes extra wrapping. Preview/export
  // hide overflow, so this learner-sized off-screen box is the source of truth.
  const host = document.createElement("div");
  host.dataset.qbMeasurement = "learner";
  host.innerHTML = editor.innerHTML;

  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${profile.width}px`,
    height: `${profile.height}px`,
    padding: profile.padding,
    boxSizing: "border-box",
    display: "block",
    visibility: "hidden",
    pointerEvents: "none",
    zIndex: "-1",
    overflow: "hidden",
    overflowX: "hidden",
    overflowY: "hidden",
    color: "#00273b",
    fontFamily: "Roboto, Arial, sans-serif",
    fontSize: profile.fontSize,
    fontWeight: profile.fontWeight,
    lineHeight: getEditorLineSpacing(editor),
    textAlign: profile.textAlign,
    whiteSpace: "normal",
    wordBreak: "normal",
    overflowWrap: "break-word"
  });

  host.querySelectorAll("p").forEach(node => { node.style.margin = "0"; });
  host.querySelectorAll("ul,ol").forEach(node => {
    node.style.margin = "0";
    node.style.paddingLeft = "1.35em";
  });

  return { host, target: host, profile };
}

function measureEditorOverflow(editorOrId) {
  const editor = typeof editorOrId === "string"
    ? document.getElementById(editorOrId)
    : editorOrId;
  if (!editor) return { vertical: false, horizontal: false, overflowY: 0, overflowX: 0 };

  const measurement = measurementHostForEditor(editor);
  if (!measurement) return { vertical: false, horizontal: false, overflowY: 0, overflowX: 0 };
  document.body.appendChild(measurement.host);

  const clientHeight = measurement.target.clientHeight;
  const clientWidth = measurement.target.clientWidth;
  const scrollHeight = measurement.target.scrollHeight;
  const scrollWidth = measurement.target.scrollWidth;
  measurement.host.remove();

  const overflowY = Math.max(0, scrollHeight - clientHeight);
  const overflowX = Math.max(0, scrollWidth - clientWidth);
  return {
    vertical: overflowY > 1,
    horizontal: overflowX > 1,
    overflowY,
    overflowX
  };
}

function measureEmbeddedVisualOverflow(editorOrId) {
  const editor = typeof editorOrId === "string"
    ? document.getElementById(editorOrId)
    : editorOrId;
  if (!editor || !editor.querySelector("img,svg,canvas,video,iframe")) return [];

  const measurement = measurementHostForEditor(editor);
  if (!measurement) return [];
  document.body.appendChild(measurement.host);

  const computed = getComputedStyle(measurement.target);
  const availableWidth = measurement.target.clientWidth
    - (Number.parseFloat(computed.paddingLeft) || 0)
    - (Number.parseFloat(computed.paddingRight) || 0);
  const availableHeight = measurement.target.clientHeight
    - (Number.parseFloat(computed.paddingTop) || 0)
    - (Number.parseFloat(computed.paddingBottom) || 0);

  const problems = [...measurement.target.querySelectorAll("img,svg,canvas,video,iframe")]
    .map((visual, index) => {
      const rect = visual.getBoundingClientRect();
      return {
        index,
        tag: visual.tagName.toLowerCase(),
        width: rect.width,
        height: rect.height,
        availableWidth,
        availableHeight
      };
    })
    .filter(item => item.width > item.availableWidth + 1 || item.height > item.availableHeight + 1);

  measurement.host.remove();
  return problems;
}

function updateEditorOverflowState(editorOrId) {
  const editor = typeof editorOrId === "string"
    ? document.getElementById(editorOrId)
    : editorOrId;
  if (!editor) return;
  const overflow = measureEditorOverflow(editor);
  editor.classList.toggle("has-overflow", overflow.vertical);
  editor.classList.toggle("has-horizontal-overflow", overflow.horizontal);
  editor.dataset.overflowY = overflow.vertical ? String(Math.ceil(overflow.overflowY)) : "0";
  editor.dataset.overflowX = overflow.horizontal ? String(Math.ceil(overflow.overflowX)) : "0";
}

function refreshAllOverflowStates() {
  document.querySelectorAll(".editable").forEach(updateEditorOverflowState);
}

function buildTitlePage() {
  return `<div class="question-block active" id="questionPage_0"><div class="quiz-canvas builder-start">
    <div class="left-panel"></div><div class="corner-art"></div><div class="brand">CourseBook</div>
    <div class="quiz-icon"></div>${editable("quizTitle","title-editable","Quiz title")}
    <div class="mock-start">Start</div></div></div>`;
}

function buildQuestionPage(i,count){
  return `<div class="question-block" id="questionPage_${i}"><div class="quiz-canvas builder-question">
    <div class="counter">${i}/${count}</div>
    <div class="question-editable-shell" onclick="if(event.target===this)this.firstElementChild.focus()">${editable(`question_${i}`,"question-editable","Question text")}</div>
    <div class="answer-editable answer-1">${editable(`q${i}_answer_1`,"answer-inner","Answer 1")}</div>
    <div class="answer-editable answer-2">${editable(`q${i}_answer_2`,"answer-inner","Answer 2")}</div>
    <div class="answer-editable answer-3">${editable(`q${i}_answer_3`,"answer-inner","Answer 3")}</div>
    <div class="answer-editable answer-4">${editable(`q${i}_answer_4`,"answer-inner","Answer 4")}</div>
    <div class="question-image-mock"><img src="assets/questions/question_${((i-1)%5)+1}.png" alt="Question illustration"></div>
    <button type="button" class="feedback-toggle" onclick="toggleBuilderFeedback()">Feedback view</button>
    <div class="feedback-mock" style="display:none"><div class="feedback-avatar-mock"><img src="assets/feedback/correct/correct_${((i-1)%5)+1}.png" alt="Feedback illustration"></div><div class="feedback-label-mock">CORRECT</div>
      ${editable(`q${i}_feedback`,"feedback-editable","Feedback text")}<div class="mock-continue">CONTINUE</div></div>
    <select id="q${i}_correct" hidden><option value="0">1</option><option value="1">2</option><option value="2">3</option><option value="3">4</option></select>
  </div></div>`;
}

function generateQuestionFields() {
  if (htmlEditorOpen) closeHtmlEditorPanel(false);
  const count=Number(document.getElementById("questionCount").value);
  const oldTitle=document.getElementById("quizTitle")?.innerHTML||"";
  const container=document.getElementById("questionsContainer");
  const tabs=document.getElementById("questionTabs");
  container.innerHTML=buildTitlePage(); tabs.innerHTML=`<button type="button" class="question-tab active" onclick="showQuestionPage(0)">Title</button>`;
  for(let i=1;i<=count;i++){
    container.insertAdjacentHTML("beforeend",buildQuestionPage(i,count));
    tabs.insertAdjacentHTML("beforeend",`<button type="button" class="question-tab" onclick="showQuestionPage(${i})">Q${i}</button>`);
  }
  setHtml("quizTitle",oldTitle);
  document.querySelectorAll('.editable').forEach(registerEditable);
  refreshAllOverflowStates();
  currentBuilderPage=0; activeEditorId=null; savedSelection=null; feedbackVisible=allFeedbackVisible;
  applyAllFeedbackVisibility();
  updateFeedbackDefaultToggleUi();
  updateBuilderPageUi();
  resizeBuilderCanvas();
}

function resetQuiz() {
  const titleEditor = document.getElementById("quizTitle");
  if (titleEditor) titleEditor.innerHTML = "";
  document.getElementById("quizFilename").value = "";
  localStorage.removeItem(AUTOSAVE_KEY);
  generateQuestionFields();
  setHtml("quizTitle", "");
}

function showQuestionPage(page){
  if (htmlEditorOpen) closeHtmlEditorPanel();
  const count=Number(document.getElementById("questionCount").value);
  currentBuilderPage=Math.max(0,Math.min(page,count));
  document.querySelectorAll('.question-block').forEach((b,i)=>b.classList.toggle('active',i===currentBuilderPage));
  document.querySelectorAll('.question-tab').forEach((t,i)=>t.classList.toggle('active',i===currentBuilderPage));
  feedbackVisible=allFeedbackVisible;
  const panel=document.querySelector(`#questionPage_${currentBuilderPage} .feedback-mock`);
  if(panel) panel.style.display=feedbackVisible?'block':'none';
  if(feedbackVisible) updateEditorOverflowState(`q${currentBuilderPage}_feedback`);
  activeEditorId=null;savedSelection=null;updateBuilderPageUi();resizeBuilderCanvas();
}

function moveBuilderPage(step){showQuestionPage(currentBuilderPage+step);}
function updateBuilderPageUi(){
  const count=Number(document.getElementById("questionCount").value);
  document.getElementById('pageIndicator').textContent=currentBuilderPage===0?'Title screen':`Question ${currentBuilderPage} of ${count}`;
  document.getElementById('correctAnswerControl').classList.toggle('is-hidden',currentBuilderPage===0);
  if(currentBuilderPage>0)document.getElementById('activeCorrectAnswer').value=document.getElementById(`q${currentBuilderPage}_correct`).value;
  document.getElementById('activeFieldLabel').textContent='Select a text field';
  document.getElementById('sharedToolbar').classList.add('inactive');
  updateToolbarState();
}
function updateActiveCorrectAnswer(value){if(currentBuilderPage>0)document.getElementById(`q${currentBuilderPage}_correct`).value=value;}
function updateFeedbackDefaultToggleUi(){
  const button=document.getElementById("feedbackDefaultToggle");
  if(!button)return;
  button.textContent=allFeedbackVisible?"Hide all feedback":"Show all feedback";
  button.setAttribute("aria-pressed",String(allFeedbackVisible));
  button.classList.toggle("is-active",allFeedbackVisible);
}

function applyAllFeedbackVisibility(){
  document.querySelectorAll(".feedback-mock").forEach(panel=>{
    panel.style.display=allFeedbackVisible?"block":"none";
  });
  feedbackVisible=allFeedbackVisible && currentBuilderPage>0;
  if(allFeedbackVisible){
    document.querySelectorAll(".feedback-editable").forEach(updateEditorOverflowState);
  }
}

function toggleAllBuilderFeedback(){
  allFeedbackVisible=!allFeedbackVisible;
  applyAllFeedbackVisibility();
  updateFeedbackDefaultToggleUi();
}

function toggleBuilderFeedback(){
  if(currentBuilderPage===0)return;
  feedbackVisible=!feedbackVisible;
  const page=document.getElementById(`questionPage_${currentBuilderPage}`);
  const panel=page?.querySelector('.feedback-mock');
  if(panel)panel.style.display=feedbackVisible?'block':'none';
  if(feedbackVisible) updateEditorOverflowState(`q${currentBuilderPage}_feedback`);
}


// ── Validation ─────────────────────────────────────────────

function validateQuizForm() {
  const title = document.getElementById("quizTitle").innerHTML.trim();
  const count = Number(document.getElementById("questionCount").value);

  if (!title) { alert("Please enter a quiz title."); return false; }

  const filename = document.getElementById("quizFilename").value.trim();
  if (!filename) { alert("Please enter a file name."); return false; }

  for (let i = 1; i <= count; i++) {
    if (!getText(`question_${i}`)) {
      alert(`Please enter text for Question ${i}.`); return false;
    }
    for (let a = 1; a <= 4; a++) {
      if (!getText(`q${i}_answer_${a}`)) {
        alert(`Please enter Answer ${a} for Question ${i}.`); return false;
      }
    }
  }
  return true;
}

// ── Export data builder ────────────────────────────────────

function buildQuizExportData() {
  const title = document.getElementById("quizTitle").innerHTML.trim();
  const count = Number(document.getElementById("questionCount").value);

  const questions = [];
  for (let i = 1; i <= count; i++) {
    questions.push({
      question:     getHtml(`question_${i}`),
      answers:      [1, 2, 3, 4].map(a => getHtml(`q${i}_answer_${a}`)),
      correctIndex: Number(document.getElementById(`q${i}_correct`).value),
      feedback:     getHtml(`q${i}_feedback`),
    });
  }
  const filename = document.getElementById("quizFilename").value.trim();
  const randomizePreview = document.getElementById("randomizePreview");
  const randomizeAnswersPreview = document.getElementById("randomizeAnswersPreview");
  const randomizeExport = document.getElementById("randomizeExport");
  const randomizeAnswersExport = document.getElementById("randomizeAnswersExport");
  return {
    title,
    filename,
    questions,
    randomizePreview: randomizePreview ? randomizePreview.checked : true,
    randomizeAnswersPreview: randomizeAnswersPreview ? randomizeAnswersPreview.checked : true,
    randomizeExport: randomizeExport ? randomizeExport.checked : true,
    randomizeAnswersExport: randomizeAnswersExport ? randomizeAnswersExport.checked : true
  };
}

// ── Preview ────────────────────────────────────────────────

function previewQuiz() {
  // Preview uses the current learner design and the PNG authoring assets.
  // Export uses the platform-proven V5 runtime with matching CSS and PNG assets.
  const exportData = buildQuizExportData();
  const previewTitle = getText("quizTitle") || "Quiz Preview";
  const win = window.open("", "_blank");

  if (!win) {
    alert("The preview window was blocked. Please allow pop-ups for this page and try again.");
    return;
  }

  win.document.open();
  win.document.write(
    buildPreviewQuizHtml(exportData, previewTitle, document.baseURI)
  );
  win.document.close();
}

// ── JSON export / import ───────────────────────────────────

function exportQuizJson() {
  if (!validateQuizForm()) return;
  const data = buildQuizExportData();
  downloadBlob(JSON.stringify(data, null, 2), `${getFilename()}.json`, "application/json");
}

function importQuizJson() {
  const file = document.getElementById("importJsonFile").files[0];
  if (!file) { alert("Please select a JSON file first."); return; }

  readFile(file, text => {
    const data = JSON.parse(text);
    document.getElementById("quizTitle").innerHTML = data.title || "";
    document.getElementById("quizFilename").value = data.filename || "";
    document.getElementById("questionCount").value = data.questions.length;
    document.getElementById("randomizePreview").checked = data.randomizePreview !== false;
    document.getElementById("randomizeAnswersPreview").checked = data.randomizeAnswersPreview !== false;
    document.getElementById("randomizeExport").checked = data.randomizeExport !== false;
    document.getElementById("randomizeAnswersExport").checked = data.randomizeAnswersExport !== false;
    generateQuestionFields();
    populateFields(data.questions);
  });
}

// ── Standalone HTML export / import ───────────────────────

// Export-only platform assets. The platform-proven V5 runtime now uses PNG files.
// Builder and Preview PNG files remain under assets/.
const EXPORT_IMAGE_FILES = [
  "image1.png", "image2.png", "image3.png", "image4.png", "image5.png",
  "correct1.png", "correct2.png", "correct3.png", "correct4.png", "correct5.png",
  "incorrect1.png", "incorrect2.png", "incorrect3.png", "incorrect4.png", "incorrect5.png",
  "CB_icon.png", "CB_logo.png", "quiz_icon.png"
];

async function exportStandaloneQuiz() {
  if (!validateQuizForm()) return;

  const data = buildQuizExportData();
  const html = buildStandaloneQuizHtml(data, data.title);

  console.log("STORY HTML START:");
  console.log(html.substring(0, 500));

  const folderName = getFilename();

  if (typeof JSZip === "undefined") {
    downloadBlob(html, `${folderName}.html`, "text/html");
    return;
  }

  const zip = new JSZip();

const packageFolder = zip.folder(folderName);
packageFolder.file("story.html", html);

const imgFolder = packageFolder.folder("img");

let imagesBundled = 0;

for (const name of EXPORT_IMAGE_FILES) {
  try {
    const res = await fetch(`img/${name}`);

    if (!res.ok) {
      console.warn(`Could not load image: img/${name}`);
      continue;
    }

    const blob = await res.blob();

    imgFolder.file(name, blob, {
      binary: true
    });

    imagesBundled++;
  } catch (error) {
    console.warn(`Failed to bundle image: img/${name}`, error);
  }
}

  if (imagesBundled !== EXPORT_IMAGE_FILES.length) {
    alert(
      "Export cancelled because one or more required PNG files could not be loaded.\n\n" +
      "Make sure all 18 PNG files are in the builder's img folder and run the builder through Live Server."
    );
    return;
  }

  const blob = await zip.generateAsync({
  type: "blob",
  compression: "DEFLATE",
  compressionOptions: {
    level: 6
  }
});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${folderName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importStandaloneHtml() {
  const file = document.getElementById("importHtmlFile").files[0];
  if (!file) { alert("Please select an HTML or JSON file first."); return; }

  readFile(file, text => {
    try {
      const isJson = /\.json$/i.test(file.name) || /^\s*[\[{]/.test(text);
      let questions;
      let title = "Imported Quiz";
      let filename = file.name.replace(/\.(html?|json)$/i, "");
      let randomizeExport = true;
      let randomizeAnswersExport = true;

      if (isJson) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          questions = parsed;
        } else if (parsed && typeof parsed === "object") {
          questions = parsed.questions;
          if (typeof parsed.title === "string" && parsed.title.trim()) title = parsed.title;
          if (typeof parsed.filename === "string" && parsed.filename.trim()) filename = parsed.filename;
          if (typeof parsed.randomizeExport === "boolean") randomizeExport = parsed.randomizeExport;
          if (typeof parsed.randomizeAnswersExport === "boolean") randomizeAnswersExport = parsed.randomizeAnswersExport;
        }
        if (!Array.isArray(questions)) throw new Error("Could not find a questions array in this JSON file.");
      } else {
        const dataMatch = text.match(/const originalQuizData = (\[[\s\S]*?\]);/);
        if (!dataMatch) throw new Error("Could not find quiz data in this HTML file.");
        questions = JSON.parse(dataMatch[1]);

        // Prefer quiz-title meta (preserves rich HTML), fall back to <title>.
        const quizTitleMatch = text.match(/<meta name="quiz-title" content="([^"]*)">/);
        const titleTagMatch = text.match(/<title>(.*?)<\/title>/);
        title = quizTitleMatch ? quizTitleMatch[1] : (titleTagMatch ? titleTagMatch[1] : "Imported Quiz");

        // Filename: prefer meta tag, fall back to the uploaded file's own name.
        const filenameMatch = text.match(/<meta name="quiz-filename" content="([^"]*)">/);
        filename = (filenameMatch && filenameMatch[1])
          ? filenameMatch[1]
          : file.name.replace(/\.html$/i, "");

        const randomizeExportMatch = text.match(/<meta name="quiz-randomize-export" content="(true|false)">/i);
        const randomizeAnswersExportMatch = text.match(/<meta name="quiz-randomize-answers-export" content="(true|false)">/i);
        randomizeExport = !randomizeExportMatch || randomizeExportMatch[1].toLowerCase() !== "false";
        randomizeAnswersExport = !randomizeAnswersExportMatch || randomizeAnswersExportMatch[1].toLowerCase() !== "false";
      }

      if (!questions.length) throw new Error("The imported file does not contain any questions.");
      questions.forEach((question, index) => {
        if (!question || typeof question !== "object") throw new Error(`Question ${index + 1} is not valid.`);
        if (!Array.isArray(question.answers) || question.answers.length !== 4) {
          throw new Error(`Question ${index + 1} must contain exactly 4 answers.`);
        }
      });

      document.getElementById("quizTitle").innerHTML = title;
      document.getElementById("quizFilename").value = filename;
      document.getElementById("questionCount").value = questions.length;
      document.getElementById("randomizePreview").checked = true;
      document.getElementById("randomizeAnswersPreview").checked = true;
      document.getElementById("randomizeExport").checked = randomizeExport;
      document.getElementById("randomizeAnswersExport").checked = randomizeAnswersExport;
      generateQuestionFields();
      populateFields(questions, true);
      alert(isJson ? "AI JSON imported successfully." : "Standalone HTML imported successfully.");
    } catch (error) {
      console.error("Could not import quiz file:", error);
      alert(error && error.message ? error.message : "Could not import this quiz file.");
    }
  });
}

// ── Shared import helper ───────────────────────────────────

const QB_MATH_ALIGN_ATTRIBUTE = "data-qb-align";

function normaliseImportedRichText(value) {
  const host = document.createElement("div");
  host.innerHTML = String(value || "");

  host.querySelectorAll("math").forEach(math => {
    const displayAttribute = (math.getAttribute("display") || "").trim().toLowerCase();
    const cssDisplay = (math.style.display || "").trim().toLowerCase();
    const isDisplayMath = displayAttribute === "block" || cssDisplay === "block";

    if (!isDisplayMath) {
      // Inline maths must stay in sentence flow. Remove accidental full-width
      // sizing that some AI conversions add to otherwise-inline MathML.
      if (math.style.width === "100%") math.style.removeProperty("width");
      if (math.style.minWidth) math.style.removeProperty("min-width");
      if (math.style.maxWidth === "100%") math.style.removeProperty("max-width");
      return;
    }

    let align = (math.getAttribute(QB_MATH_ALIGN_ATTRIBUTE) || math.style.textAlign || "left")
      .trim()
      .toLowerCase();
    if (!['left', 'center', 'right'].includes(align)) align = "left";

    math.setAttribute("display", "block");
    math.setAttribute(QB_MATH_ALIGN_ATTRIBUTE, align);

    // Keep the equation on its own line, but make the MathML box intrinsic
    // width. A normal display:block MathML box can become container-width in
    // Chromium, which makes <mfrac> draw a fraction bar across the textbox.
    math.style.setProperty("display", "block");
    math.style.setProperty("width", "max-content");
    math.style.setProperty("max-width", "100%");
    math.style.setProperty("min-width", "0");
    math.style.setProperty("box-sizing", "border-box");
    math.style.setProperty("text-align", "left");

    // Remove common AI-added stretching from MathML descendants too. These
    // properties are not needed for semantic fractions/tables and can turn a
    // natural-width equation into a full-row rule.
    math.querySelectorAll("mfrac,mrow,mtable,mtd").forEach(node => {
      if (node.style.width === "100%") node.style.removeProperty("width");
      if (node.style.minWidth) node.style.removeProperty("min-width");
      if (node.style.maxWidth === "100%") node.style.removeProperty("max-width");
      if (node.style.flexGrow) node.style.removeProperty("flex-grow");
    });

    if (align === "center") {
      math.style.setProperty("margin", "0 auto");
    } else if (align === "right") {
      math.style.setProperty("margin", "0 0 0 auto");
    } else {
      math.style.setProperty("margin", "0 auto 0 0");
    }
  });

  return host.innerHTML;
}

function populateFields(questions, fromStandalone = false) {
  questions.forEach((item, index) => {
    const n = index + 1;
    const questionHtml = fromStandalone ? normaliseImportedRichText(item.question) : item.question;
    setHtml(`question_${n}`, questionHtml);

    item.answers.forEach((answer, ai) => {
      const rawAnswer = fromStandalone
        ? (typeof answer === "string" ? answer : answer.text)
        : answer;
      setHtml(`q${n}_answer_${ai + 1}`, fromStandalone ? normaliseImportedRichText(rawAnswer) : rawAnswer);
    });

    if (fromStandalone) {
      const correctIndex = item.answers.findIndex(a => typeof a === "object" && a.isCorrect);
      document.getElementById(`q${n}_correct`).value =
        correctIndex >= 0 ? correctIndex : (item.correctIndex ?? 0);
    } else {
      document.getElementById(`q${n}_correct`).value = item.correctIndex ?? 0;
    }

    setHtml(`q${n}_feedback`, fromStandalone
      ? normaliseImportedRichText(item.feedback || "")
      : (item.feedback || ""));
  });
}

// ── Utility ────────────────────────────────────────────────

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function readFile(file, onLoad) {
  const reader = new FileReader();
  reader.onload = e => onLoad(e.target.result);
  reader.readAsText(file);
}

function shuffleArray(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// ── Legacy in-page preview (renderQuiz / submitQuiz) ──────
// Kept for backwards compatibility with the #quizPreview section.

function renderQuiz(title) {
  document.getElementById("builder").style.display      = "none";
  document.getElementById("quizPreview").style.display  = "block";
  document.getElementById("results").style.display      = "none";
  document.getElementById("previewTitle").innerHTML = title;

  const container = document.getElementById("quizContainer");
  container.innerHTML = "";

  activeQuiz.forEach((item, qi) => {
    const answersHtml = item.answers.map((answer, ai) => `
      <label>
        <input type="radio" name="question_${qi}" value="${ai}">
        ${answer.text}
      </label>
    `).join("");

    container.innerHTML += `
      <div class="quiz-question">
        <h3>${qi + 1}. ${item.question}</h3>
        ${answersHtml}
      </div>
    `;
  });
}

function submitQuiz() {
  let score = 0, feedbackHtml = "";

  activeQuiz.forEach((question, qi) => {
    const selected = document.querySelector(`input[name="question_${qi}"]:checked`);

    if (!selected) {
      feedbackHtml += `<div><h3>Question ${qi + 1}</h3><p>No answer selected.</p><p>${question.feedback || ""}</p></div>`;
      return;
    }

    const answer = question.answers[Number(selected.value)];
    if (answer.isCorrect) score++;

    feedbackHtml += `
      <div>
        <h3>Question ${qi + 1}</h3>
        <p>${answer.isCorrect ? "Correct ✓" : "Incorrect ✗"}</p>
        <p>${question.feedback || ""}</p>
      </div>
    `;
  });

  document.getElementById("quizPreview").style.display = "none";
  document.getElementById("results").style.display     = "block";
  document.getElementById("scoreText").innerHTML =
    `You scored ${score} out of ${activeQuiz.length}.<hr>${feedbackHtml}`;
}

function restartBuilder() {
  document.getElementById("builder").style.display      = "block";
  document.getElementById("quizPreview").style.display  = "none";
  document.getElementById("results").style.display      = "none";
}



// ── Copy AI import prompt to clipboard ────────────────────────
function updateAiPromptModeUi() {
  const mode = document.getElementById("aiPromptMode")?.value || "fast";
  const note = document.getElementById("aiPromptModeNote");
  const button = document.getElementById("copyPromptButton");

  if (mode === "fidelity") {
    if (note) note.textContent = "High fidelity: slower, but asks the AI to inspect essential graphs/diagrams, source sizing and equation alignment more closely.";
    if (button) button.textContent = "Copy High-Fidelity Prompt";
  } else {
    if (note) note.textContent = "Fast: extracts wording, answers, feedback and structured maths. The builder normalises predictable MathML layout after import.";
    if (button) button.textContent = "Copy Fast Prompt";
  }
}

async function copyAiPrompt() {
  const mode = document.getElementById("aiPromptMode")?.value || "fast";
  const promptField = document.getElementById(mode === "fidelity" ? "aiPromptFidelity" : "aiPromptFast");
  const button = document.getElementById("copyPromptButton");
  if (!promptField) return;

  const promptText = promptField.value;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(promptText);
    } else {
      const fallback = document.createElement("textarea");
      fallback.value = promptText;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.left = "-9999px";
      fallback.style.top = "0";
      document.body.appendChild(fallback);
      fallback.focus();
      fallback.select();
      const copied = document.execCommand("copy");
      fallback.remove();
      if (!copied) throw new Error("Clipboard copy was not available.");
    }

    if (button) button.textContent = "Copied!";
  } catch (error) {
    console.error("Could not copy the AI prompt:", error);
    if (button) button.textContent = "Copy failed";
  }

  setTimeout(updateAiPromptModeUi, 1400);
}


// ── HTML → docx TextRuns (browser) ────────────────────────────
function htmlToRuns(html) {
  const { TextRun } = docx;
  if (!html) return [new TextRun({ text: "" })];

  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n');

  const runs = [];
  const TOKEN = /(<[^>]+>)|([^<]+)/g;
  const stack = [{ bold: false, italics: false, underline: false, superScript: false, subScript: false, size: 22, font: "Arial" }];
  const top = () => stack[stack.length - 1];

  let m;
  while ((m = TOKEN.exec(text)) !== null) {
    if (m[1]) {
      const tag  = m[1];
      const name = (tag.match(/^<\/?([a-zA-Z0-9]+)/) || [])[1]?.toLowerCase();
      const closing = tag.startsWith('</');
      if (!closing) {
        const fmt = { ...top() };
        if (name === 'b' || name === 'strong') fmt.bold = true;
        if (name === 'i' || name === 'em')     fmt.italics = true;
        if (name === 'u')                       fmt.underline = {};
        if (name === 'sup')                     fmt.superScript = true;
        if (name === 'sub')                     fmt.subScript = true;
        const sm = tag.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
        if (sm) fmt.size = Math.round(parseFloat(sm[1]) * 2);
        stack.push(fmt);
      } else {
        if (stack.length > 1) stack.pop();
      }
    } else if (m[2]) {
      const raw = m[2]
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      if (raw) {
        const f = top();
        runs.push(new TextRun({ text: raw, bold: f.bold, italics: f.italics,
          underline: f.underline, superScript: f.superScript, subScript: f.subScript,
          size: f.size, font: f.font }));
      }
    }
  }
  return runs.length ? runs : [new TextRun({ text: "" })];
}

// ── Build one question table ──────────────────────────────────
function buildWordTable(q, idx, total) {
  const { Table, TableRow, TableCell, Paragraph, TextRun,
          BorderStyle, WidthType, ShadingType, VerticalAlign, AlignmentType } = docx;

  const C = { teal: "0F9691", blue: "C5E3EF", grey: "EEF2F6", ok: "D1FAE5", white: "FFFFFF" };
  const PAGE_W   = 9026;
  const COL_TICK = 560;
  const COL_TEXT = PAGE_W - COL_TICK;
  const border   = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
  const borders  = { top: border, bottom: border, left: border, right: border };

  function mkCell(paras, fill, span) {
    const w = span === 2 ? PAGE_W : span === "tick" ? COL_TICK : COL_TEXT;
    return new TableCell({
      borders,
      columnSpan: span === 2 ? 2 : 1,
      width: { size: w, type: WidthType.DXA },
      shading: { fill: fill || C.white, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 140, right: 140 },
      verticalAlign: VerticalAlign.CENTER,
      children: paras
    });
  }

  function hdr(text) {
    return new Paragraph({ children: [
      new TextRun({ text, bold: true, color: "FFFFFF", size: 22, font: "Arial" })
    ]});
  }

  return new Table({
    width: { size: PAGE_W, type: WidthType.DXA },
    columnWidths: [COL_TICK, COL_TEXT],
    rows: [
      new TableRow({ children: [mkCell([hdr(`Question ${idx + 1} of ${total}`)], C.teal, 2)] }),
      new TableRow({ children: [mkCell([new Paragraph({ children: htmlToRuns(q.question) })], C.grey, 2)] }),
      ...q.answers.map((ans, ai) => {
        const correct = ai === q.correctIndex;
        return new TableRow({ children: [
          mkCell([new Paragraph({ alignment: AlignmentType.CENTER, children: [
            new TextRun({ text: correct ? "✓" : " ", bold: true, color: "16803C", size: 24, font: "Arial" })
          ]})], correct ? C.ok : C.white, "tick"),
          mkCell([new Paragraph({ children: htmlToRuns(ans) })], correct ? C.ok : C.white, "text")
        ]});
      }),
      new TableRow({ children: [mkCell([hdr("Feedback")], C.teal, 2)] }),
      new TableRow({ children: [mkCell([new Paragraph({ children: htmlToRuns(q.feedback || "") })], C.blue, 2)] })
    ]
  });
}

// ── Export to Word (browser) ──────────────────────────────────
async function exportToWord() {
  if (!validateQuizForm()) return;

  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  const data = buildQuizExportData();

  const children = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: htmlToRuns(data.title || "Quiz") }),
    new Paragraph({ children: [new TextRun({ text: "" })] }),
    ...data.questions.flatMap((q, i) => [
      buildWordTable(q, i, data.questions.length),
      new Paragraph({ children: [new TextRun({ text: "" })] })
    ])
  ];

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 22, color: "052D43" } } },
      paragraphStyles: [{
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 40, bold: true, font: "Arial", color: "052D43" },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 }
      }]
    },
    sections: [{ properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    }, children }]
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${getFilename()}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Import from Word (not supported in browser) ───────────────
function importFromWord() {
  alert("Word import is not supported in the browser.\nTo import a saved quiz, use the 'Import Standalone HTML' option instead.");
}

// ── Current learner preview HTML builder ──────────────────

function buildPreviewQuizHtml(exportData, title, baseUrl) {
  const plainTitle = (title || "Quiz").replace(/<[^>]+>/g, "");
  const safeFilename = exportData.filename || plainTitle.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeBaseUrl = String(baseUrl || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const runtime = `
"use strict";
const originalQuizData = __DATA__;
const quizStage=document.getElementById("quizStage"),startScreen=document.getElementById("startScreen"),questionScreen=document.getElementById("questionScreen"),startButton=document.getElementById("startButton"),currentQuestionNumber=document.getElementById("currentQuestionNumber"),totalQuestions=document.getElementById("totalQuestions"),questionText=document.getElementById("questionText"),answersList=document.getElementById("answersList"),questionImage=document.getElementById("questionImage"),submitButton=document.getElementById("submitButton"),feedbackPanel=document.getElementById("feedbackPanel"),feedbackAvatar=document.getElementById("feedbackAvatar"),feedbackLabel=document.getElementById("feedbackLabel"),feedbackText=document.getElementById("feedbackText"),continueButton=document.getElementById("continueButton"),resultsScreen=document.getElementById("resultsScreen"),resultsScore=document.getElementById("resultsScore"),reviewQuizButton=document.getElementById("reviewQuizButton"),reviewPreviousButton=document.getElementById("reviewPreviousButton"),reviewNextButton=document.getElementById("reviewNextButton"),resultStarFills=document.querySelectorAll(".result-star .star-fill"),resultsStars=document.getElementById("resultsStars");
const SLIDE_WIDTH=720,SLIDE_HEIGHT=540,START_EXIT_DURATION=1500,FADE_DURATION=500,ANSWER_FADE_DELAY=400,STAR_STEP_DURATION=250;
let questionOrder=[],currentQuestionPosition=0,selectedOption=null,correctAnswerCount=0,isReviewMode=false,reviewQuestionPosition=0,resultsHaveBeenRecorded=false,resultsHaveBeenShown=false,quizHasStarted=false;const reviewAnswers={};
if(typeof window.started!=="function")window.started=()=>console.log("Local preview: started()");if(typeof window.completed!=="function")window.completed=s=>console.log("Local preview: completed("+s+")");
const correctAvatars=[1,2,3,4,5].map(n=>"img/correct"+n+".png"),incorrectAvatars=[1,2,3,4,5].map(n=>"img/incorrect"+n+".png");let cq=[],iq=[];
const RANDOMIZE_QUESTIONS=__RANDOMIZE_PREVIEW__;
const RANDOMIZE_ANSWERS=__RANDOMIZE_ANSWERS_PREVIEW__;
const feedbackImagePromises=new Map();let feedbackSequence=0;
function preloadFeedbackImage(src){if(!src)return Promise.resolve();if(!feedbackImagePromises.has(src)){feedbackImagePromises.set(src,new Promise(resolve=>{const img=new Image(),finish=()=>{if(typeof img.decode==="function")img.decode().then(resolve).catch(resolve);else resolve()};img.onload=finish;img.onerror=resolve;img.src=src}))}return feedbackImagePromises.get(src)}
[...correctAvatars,...incorrectAvatars].forEach(preloadFeedbackImage);
function resizeQuiz(){quizStage.style.transform="scale("+Math.min(innerWidth/SLIDE_WIDTH,innerHeight/SLIDE_HEIGHT)+")"}addEventListener("resize",resizeQuiz);resizeQuiz();
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function nextAvatar(ok){let q=ok?cq:iq,p=ok?correctAvatars:incorrectAvatars;if(!q.length){q.push(...shuffle(p));if(ok)cq=q;else iq=q}return q.shift()}
function stripOrHtml(el,html){el.innerHTML=html||""}
function generateQuestionOrder(){const ordered=originalQuizData.map((_,i)=>i);questionOrder=RANDOMIZE_QUESTIONS?shuffle(ordered):ordered;if(RANDOMIZE_QUESTIONS&&questionOrder.length===5){let guard=0;while(Math.abs(questionOrder.indexOf(0)-questionOrder.indexOf(4))===1&&guard++<50)questionOrder=shuffle(ordered)}}
function answersFor(qi){const q=originalQuizData[qi];return q.answers.map((text,i)=>({id:"q"+qi+"a"+i,text,correct:i===q.correctIndex}))}
function clearAnswerSelection(){answersList.querySelectorAll(".answer-option").forEach(o=>{o.className="answer-option question-part";o.setAttribute("aria-checked","false");o.disabled=false});selectedOption=null;submitButton.classList.remove("is-visible")}
function hideFeedback(){feedbackSequence++;feedbackPanel.classList.remove("is-visible","show-details");feedbackPanel.setAttribute("aria-hidden","true");feedbackAvatar.style.visibility="hidden"}
function renderQuestion(pos,stored=null){const qi=questionOrder[pos],q=originalQuizData[qi],opts=[...answersList.querySelectorAll(".answer-option")];currentQuestionPosition=pos;currentQuestionNumber.textContent=String(pos+1);totalQuestions.textContent="/"+questionOrder.length;stripOrHtml(questionText,q.question);questionImage.src="img/image"+((qi%5)+1)+".png";clearAnswerSelection();hideFeedback();const answers=stored?stored.answerOrder:(RANDOMIZE_ANSWERS?shuffle(answersFor(qi)):answersFor(qi));opts.forEach((o,i)=>{const a=answers[i];o.dataset.answerId=a.id;o.dataset.correct=String(a.correct);stripOrHtml(o.querySelector(".answer-text"),a.text)})}
function showQuestionScreen(animate=true){questionScreen.classList.add("is-active");questionScreen.setAttribute("aria-hidden","false");const parts=questionScreen.querySelectorAll(".question-part");parts.forEach(p=>p.classList.remove("fade-in"));document.querySelector(".question-number").classList.add("fade-in");if(!animate){answersList.querySelectorAll(".answer-option").forEach(o=>o.classList.add("fade-in"));questionImage.classList.add("fade-in");return}setTimeout(()=>{answersList.querySelectorAll(".answer-option").forEach(o=>o.classList.add("fade-in"));questionImage.classList.add("fade-in")},ANSWER_FADE_DELAY)}
async function showFeedback(ok,avatar){const src=avatar||nextAvatar(ok),sequence=++feedbackSequence;feedbackLabel.textContent=ok?"CORRECT":"INCORRECT";feedbackLabel.classList.toggle("correct",ok);feedbackLabel.classList.toggle("incorrect",!ok);stripOrHtml(feedbackText,originalQuizData[questionOrder[currentQuestionPosition]].feedback);feedbackPanel.classList.remove("is-visible","show-details");feedbackPanel.setAttribute("aria-hidden","true");feedbackAvatar.style.visibility="hidden";await preloadFeedbackImage(src);if(sequence!==feedbackSequence)return;feedbackAvatar.src=src;feedbackAvatar.style.visibility="visible";feedbackPanel.classList.add("is-visible");feedbackPanel.setAttribute("aria-hidden","false");setTimeout(()=>{if(sequence===feedbackSequence)feedbackPanel.classList.add("show-details")},FADE_DURATION)}
answersList.addEventListener("click",e=>{if(isReviewMode)return;const o=e.target.closest(".answer-option");if(!o||o.disabled)return;answersList.querySelectorAll(".answer-option").forEach(x=>{x.classList.remove("selected");x.setAttribute("aria-checked","false")});o.classList.add("selected");o.setAttribute("aria-checked","true");selectedOption=o;submitButton.classList.add("is-visible")});
submitButton.addEventListener("click",()=>{if(!selectedOption)return;const opts=[...answersList.querySelectorAll(".answer-option")],ok=selectedOption.dataset.correct==="true",qi=questionOrder[currentQuestionPosition],avatar=nextAvatar(ok);if(ok)correctAnswerCount++;reviewAnswers[qi]={selectedAnswerId:selectedOption.dataset.answerId,selectedWasCorrect:ok,feedbackAvatar:avatar,answerOrder:opts.map(o=>({id:o.dataset.answerId,text:o.querySelector(".answer-text").innerHTML,correct:o.dataset.correct==="true"}))};opts.forEach(o=>{o.disabled=true;o.classList.remove("selected");if(o===selectedOption)o.classList.add(ok?"correct":"incorrect");else if(!ok&&o.dataset.correct==="true")o.classList.add("disabled-correct");else o.classList.add("disabled-neutral")});submitButton.style.transition="none";submitButton.classList.remove("is-visible");void submitButton.offsetWidth;submitButton.style.transition="";questionImage.classList.remove("fade-in");showFeedback(ok,avatar)});
continueButton.addEventListener("click", () => {
  if (currentQuestionPosition >= questionOrder.length - 1) {
    return showResults();
  }

  // Hide the answers immediately so their previous fade state cannot flash.
  questionScreen.classList.add("is-resetting");
  questionScreen.classList.remove("is-active");
  questionScreen.setAttribute("aria-hidden", "true");

  renderQuestion(++currentQuestionPosition);

  // Force the browser to apply the hidden state before showing the screen.
  void questionScreen.offsetWidth;

  questionScreen.classList.remove("is-resetting");
  showQuestionScreen(true);
});
function showResults(){questionScreen.classList.remove("is-active","is-reviewing");questionScreen.setAttribute("aria-hidden","true");hideFeedback();resultsScore.textContent=correctAnswerCount+"/"+questionOrder.length;const earnedStars=questionOrder.length?correctAnswerCount/questionOrder.length*5:0;const shouldAnimate=!resultsHaveBeenShown;const visibleStarFills=[];resultStarFills.forEach((starFill,index)=>{const fillAmount=Math.max(0,Math.min(1,earnedStars-index));starFill.style.clipPath="inset(0 "+((1-fillAmount)*100)+"% 0 0)";starFill.classList.toggle("is-visible",!shouldAnimate);if(fillAmount>0)visibleStarFills.push(starFill);});resultsScore.classList.toggle("is-visible",!shouldAnimate);reviewQuizButton.classList.toggle("is-visible",!shouldAnimate);resultsStars.setAttribute("aria-label",correctAnswerCount+" correct out of "+questionOrder.length);resultsScreen.classList.add("is-active");resultsScreen.setAttribute("aria-hidden","false");if(shouldAnimate){visibleStarFills.forEach((starFill,index)=>{setTimeout(()=>starFill.classList.add("is-visible"),index*STAR_STEP_DURATION);});const scoreDelay=visibleStarFills.length*STAR_STEP_DURATION;setTimeout(()=>{
  resultsScore.classList.add("is-visible");

  setTimeout(()=>{
    reviewQuizButton.classList.add("is-visible");
  },FADE_DURATION);
},scoreDelay);}resultsHaveBeenShown=true;if(!resultsHaveBeenRecorded){resultsHaveBeenRecorded=true;window.completed(Math.round((correctAnswerCount/questionOrder.length)*100));}}
function startQuiz(){if(quizHasStarted)return;quizHasStarted=true;window.started();generateQuestionOrder();renderQuestion(0);startScreen.classList.add("is-exiting");setTimeout(()=>{startScreen.style.visibility="hidden";showQuestionScreen()},START_EXIT_DURATION)}startButton.addEventListener("click",startQuiz);
function renderReview(){const qi=questionOrder[reviewQuestionPosition],r=reviewAnswers[qi];renderQuestion(reviewQuestionPosition,r);const opts=[...answersList.querySelectorAll(".answer-option")];opts.forEach(o=>{o.disabled=true;if(o.dataset.answerId===r.selectedAnswerId)o.classList.add(r.selectedWasCorrect?"correct":"incorrect");else if(!r.selectedWasCorrect&&o.dataset.correct==="true")o.classList.add("disabled-correct");else o.classList.add("disabled-neutral")});showFeedback(r.selectedWasCorrect,r.feedbackAvatar);continueButton.style.display="none";reviewPreviousButton.disabled=false;reviewNextButton.disabled=false;showQuestionScreen()}
reviewQuizButton.addEventListener("click",()=>{isReviewMode=true;reviewQuestionPosition=0;resultsScreen.classList.remove("is-active");resultsScreen.setAttribute("aria-hidden","true");questionScreen.classList.add("is-reviewing");renderReview();});reviewPreviousButton.addEventListener("click",()=>{if(reviewQuestionPosition===0){showResults();return;}reviewQuestionPosition--;renderReview();});reviewNextButton.addEventListener("click",()=>{if(reviewQuestionPosition===questionOrder.length-1){showResults();return;}reviewQuestionPosition++;renderReview();});
`.replace("__DATA__", JSON.stringify(exportData.questions))
    .replace("__RANDOMIZE_PREVIEW__", exportData.randomizePreview === false ? "false" : "true")
    .replace("__RANDOMIZE_ANSWERS_PREVIEW__", exportData.randomizeAnswersPreview === false ? "false" : "true");
  return `<!DOCTYPE html><html lang="en"><head><base href="${safeBaseUrl}"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${plainTitle}</title><meta name="quiz-title" content="${String(title||"").replace(/"/g,"&quot;")}"><meta name="quiz-filename" content="${safeFilename}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap" rel="stylesheet"><style>:root {
  --slide-width: 720px;
  --slide-height: 540px;
  --navy: #003770;
  --title-colour: #00273b;
  --teal: #008d8c;
  --correct: #49bd98;
  --incorrect: #e24b73;
  --feedback-bg: #bad6e5;
  --start-exit-duration: 1.5s;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #ffffff;
  font-family: "Roboto", Arial, sans-serif;
}

body {
  display: flex;
  align-items: center;
  justify-content: center;
}

button { font: inherit; }
img { display: block; }

.page-shell {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.quiz-stage {
  position: relative;
  flex: 0 0 auto;
  width: var(--slide-width);
  height: var(--slide-height);
  overflow: hidden;
  background: #ffffff;
  transform-origin: center center;
}

.screen {
  position: absolute;
  inset: 0;
  width: var(--slide-width);
  height: var(--slide-height);
  overflow: hidden;
  background: #ffffff;
}

/* START SCREEN */
.start-screen {
  z-index: 2;
  transform: translateX(0);
  transition: transform var(--start-exit-duration) ease-in-out;
}

.start-screen.is-exiting {
  transform: translateX(-110%);
  pointer-events: none;
}

.left-panel { 
  position: absolute; 
  left: 0; top: 0; 
  width: 193px; 
  height: 540px; 
  background: var(--navy); 
}

.corner-graphic { 
  position: absolute; 
  left: -160px; 
  top: -105px; 
  width: 354px; 
  height: 322px; 
  max-width: none; 
  transform: scaleX(-1) rotate(60deg); 
}

.coursebook-logo { 
  position: absolute; 
  left: 24px; 
  top: 478px; 
  width: 139px; 
  height: 34px; 
  max-width: none; 
}

.quiz-icon { 
  position: absolute; 
  left: 419px; 
  top: 106px; 
  width: 74px; 
  height: 74px; 
  max-width: none; 
}

.quiz-title { 
  position: absolute; 
  left: 215px; 
  top: 181px; 
  width: 483px; 
  height: 236px; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  overflow: hidden; 
  text-align: center; 
}

.quiz-title h1 { 
  width: 100%; 
  color: var(--title-colour); 
  font-size: 40px; 
  font-weight: 500; 
  line-height: 1.1; 
  text-align: center; 
}

.start-button { 
  position: absolute; 
  left: 391px; 
  top: 420px; 
  width: 130px; 
  height: 32px; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  border: 2px solid var(--navy); 
  border-radius: 6px; 
  background: var(--navy); 
  color: #fff; 
  font-size: 16px; 
  font-weight: 400; 
  line-height: 1; 
  cursor: pointer; 
}

.start-button:hover,
.start-button:focus-visible { 
  background: #fff; 
  color: var(--navy); 
  outline: none; 
}

/* QUESTION SCREEN */
.question-screen { 
  z-index: 1; 
  visibility: hidden; 
  pointer-events: none; 
}

.question-screen.is-active { 
  visibility: visible; 
  pointer-events: auto; 
}

.question-number { 
  position: absolute; 
  left: 3px; 
  top: 3px; 
  width: 35px; 
  height: 27px; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  color: var(--teal); 
  font-weight: 300; 
  line-height: 1; 
  white-space: nowrap; 
}

.current-question { 
  font-size: 14.67px; 
}
.total-questions { 
  font-size: 14px; 
}

.question-box { 
  position: absolute; 
  left: 30px; 
  top: 30px; 
  width: 426px; 
  height: 140px; 
  display: flex; 
  align-items: center; 
  justify-content: flex-start; 
  padding: 5px 15px; 
  border-radius: 17px; 
  background: #ebeff3; 
  overflow: hidden; 
}

#questionText { 
  width: 100%; 
  color: #00273b; 
  font-size: 14.67px; 
  font-weight: 300; 
  line-height: 1.2; 
  text-align: left; 
  overflow-wrap: break-word; 
}

#questionText p,
.answer-text p,
.feedback-text p {
  margin: 0;
}

#questionText ul,
#questionText ol,
.answer-text ul,
.answer-text ol,
.feedback-text ul,
.feedback-text ol {
  margin: 0;
  padding-left: 1.35em;
}

.answers-list { 
  position: absolute; 
  inset: 0; 
}

.answer-option { 
  position: absolute; 
  left: 31px; 
  width: 426px; 
  height: 70px; 
  display: flex; 
  align-items: center; 
  padding: 5px 10px 5px 25px; 
  border: 0; 
  border-radius: 17px; 
  background: #cce8e8; 
  color: var(--teal); 
  font-size: 13.33px; 
  font-weight: 300; 
  line-height: 1.2; 
  text-align: left; 
  cursor: pointer; 
  transition: background .2s ease, color .2s ease, border .2s ease; 
}

.answer-option:nth-child(1) { 
  top: 185px; 
}

.answer-option:nth-child(2) { 
  top: 260px; 
}

.answer-option:nth-child(3) { 
  top: 335px; 
}

.answer-option:nth-child(4) { 
  top: 410px; 
}

.answer-text { 
  display: block; 
  flex: 1; 
  min-width: 0; 
  overflow-wrap: break-word; 
}

.custom-radio { 
  position: relative; 
  flex: 0 0 auto; 
  width: 30px; 
  height: 30px; 
  margin-right: 18px; 
  border: 4px solid #aebfc0; 
  border-radius: 50%; 
  background: #fff; 
}

.answer-option:hover:not(:disabled) { 
  background: #f6e6c3; 
  color: #cc9716; 
}

.answer-option:focus-visible { 
  outline: 2px solid #003770; 
  outline-offset: 2px; 
}

.answer-option.selected { 
  background: #f6e6c3; 
  color: #cc9716; 
}

.answer-option.selected .custom-radio { 
  border-color: #aebfc0; 
  background: #fff; 
}

.answer-option.selected 
.custom-radio::after { 
  content: ""; 
  position: absolute; 
  left: 50%; 
  top: 50%; 
  width: 14px; 
  height: 14px; 
  border-radius: 50%; 
  background: #e6bc48; 
  transform: translate(-50%, -50%); 
}

.answer-option.correct { 
  background: var(--correct); 
  color: #fff; 
}
.answer-option.incorrect { 
  background: var(--incorrect); 
  color: #fff; 
}

.answer-option.disabled-correct { 
  border: 0; 
  box-shadow: inset 0 0 0 2px var(--correct); 
  background: #e4f5f0; 
  color: #4abd98; 
}

.answer-option.disabled-neutral { 
  background: #ebeff3; 
  color: #9fb2bd; 
}

.answer-option:disabled { 
  cursor: default; 
}

.question-part { 
  opacity: 0; 
  transition: opacity .4s ease; 
}

.question-part.fade-in { 
  opacity: 1; 
}

.question-screen.is-resetting .answer-option,
.question-screen.is-resetting .question-image {
  opacity: 0 !important;
  transition: none !important;
}

.question-image { 
  position: absolute; 
  left: 495px; 
  top: 40px; 
  width: 195px; 
  height: 470px; 
  object-fit: contain; 
  pointer-events: none; 
}

.submit-button,
.continue-button { 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  border: 2px solid var(--teal); 
  border-radius: 18px; 
  background: var(--teal); 
  color: #fff; 
  font-size: 16px; 
  font-weight: 400; 
  line-height: 1; 
  cursor: pointer; 
  transition: opacity .5s ease, background .2s ease, color .2s ease; 
  }

.submit-button:hover,
.submit-button:focus-visible,
.continue-button:hover,
.continue-button:focus-visible { 
  background: #fff; color: var(--teal); 
  outline: none; 
  }

.submit-button {
  position: absolute;
  left: 198.5px;
  top: 498px;
  width: 103px; 
  height: 30px; 
  opacity: 0; 
  pointer-events: none; 
  }

.submit-button.is-visible { 
  opacity: 1; 
  pointer-events: auto; 
  }

/* FEEDBACK */
.feedback-panel {
  position: absolute;
  left: 486px;
  top: -1px;
  width: 241px;
  height: 541px;
  z-index: 5;
  overflow: hidden;
  background: var(--feedback-bg);

  visibility: hidden;
  pointer-events: none;

  transform: translateX(105%);
  transition: transform 0.5s ease-out;
}

.feedback-panel.is-visible {
  visibility: visible;
  pointer-events: auto;
  transform: translateX(0);
}

.feedback-hero {
  position: absolute;
  left: 0;
  top: 0;
  width: 241px;
  height: 214px;

  /* The parent panel now handles the movement */
  transform: none;
  transition: none;
}

.feedback-panel.is-visible .feedback-hero {
  transform: none;
}
.feedback-avatar { 
  position: absolute; 
  left: 22px; 
  top: 35px; 
  width: 189px; 
  height: 165px; 
  object-fit: contain; 
  z-index: 1; 
}

.feedback-label { 
  position: absolute; 
  left: 43px; 
  top: 184px; 
  width: 146px; 
  height: 30px; 
  z-index: 2; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  border-radius: 18px; 
  color: #fff; 
  font-size: 16px; 
  font-weight: 400; 
}

.feedback-label.correct { 
  background: var(--correct); 
}
.feedback-label.incorrect { 
  background: var(--incorrect); 
}

.feedback-text { 
  position: absolute; 
  left: 23px; 
  top: 230px; 
  width: 188px; 
  height: 250px; 
  overflow: hidden; 
  color: #00273b; 
  font-size: 14px; 
  font-weight: 300; 
  line-height: 1.2; 
  opacity: 0; 
  transition: opacity .5s ease; 
}
.continue-button { 
  position: absolute; 
  left: 59px; 
  top: 498px; 
  width: 118px; 
  height: 30px; 
  opacity: 0; 
  pointer-events: none; 
  transition: opacity .5s ease, background .2s ease, color .2s ease; 
}

.feedback-panel.show-details .feedback-text,
.feedback-panel.show-details .continue-button { 
  opacity: 1; 
}

.feedback-panel.show-details .continue-button { 
  pointer-events: auto; 
}


/* RESULTS SCREEN */

.results-screen {
  z-index: 6;
  visibility: hidden;
  pointer-events: none;
  background: #ffffff;
}

.results-screen.is-active {
  visibility: visible;
  pointer-events: auto;
}

.results-card {
  position: absolute;
  left: 183px;
  top: 159px;
  width: 355px;
  height: 224px;
}

/* Upper teal block */

.results-header {
  position: absolute;
  left: 0;
  top: 0;
  width: 355px;
  height: 127px;
  background: #008d8c;
}

.results-header h2 {
  position: absolute;
  left: 0;
  top: 9px;
  width: 355px;

  color: #ffffff;
  font-family: "Roboto", Arial, sans-serif;
  font-size: 18.67px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: 3px;
  text-align: center;
}

/* Stars */

.results-stars {
  position: absolute;
  left: 20px;
  top: 43px;
  width: 315px;
  height: 57px;
}

.result-star {
  position: absolute;
  top: 0;
  width: 61px;
  height: 57px;
  overflow: hidden;
}

.result-star:nth-child(1) {
  left: 0;
}

.result-star:nth-child(2) {
  left: 63px;
}

.result-star:nth-child(3) {
  left: 126px;
}

.result-star:nth-child(4) {
  left: 189px;
}

.result-star:nth-child(5) {
  left: 252px;
}

.star-grey,
.star-fill {
  position: absolute;
  left: 0;
  top: -8px;

  display: block;
  width: 61px;
  height: 65px;

  font-family: Arial, sans-serif;
  font-size: 70px;
  line-height: 1;
  text-align: center;

  user-select: none;
}

.star-grey {
  color: #dae0e4;
}

.star-fill {
  width: 61px;
  overflow: hidden;
  clip-path: inset(0 100% 0 0);
  color: #e6ba46;
  white-space: nowrap;

  opacity: 0;
  transform: scale(0);
  transform-origin: center center;

  transition:
    transform 0.25s ease-out,
    opacity 0.25s ease-out;
}

.star-fill.is-visible {
  opacity: 1;
  transform: scale(1);
}

/* Lower light-blue block */

.results-footer {
  position: absolute;
  left: 0;
  top: 127px;
  width: 355px;
  height: 97px;
  background: #cce7f1;
}

.results-score {
  position: absolute;
  left: 0;
  top: 18px;
  width: 355px;

  color: #018d8c;
  font-family: "Roboto", Arial, sans-serif;
  font-size: 21.33px;
  font-weight: 400;
  line-height: 1;
  text-align: center;
}

/* Review button */

.review-quiz-button {
  position: absolute;
  left: 104px;
  top: 57px;
  width: 147px;
  height: 30px;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 2px solid var(--teal);
  border-radius: 18px;
  background: var(--teal);
  color: #ffffff;

  font-family: "Roboto", Arial, sans-serif;
  font-size: 16px;
  font-weight: 400;
  line-height: 1;

  cursor: pointer;

  transition:
    background 0.2s ease,
    color 0.2s ease;
}

.review-quiz-button:hover,
.review-quiz-button:focus-visible {
  background: #ffffff;
  color: var(--teal);
  outline: none;
}

.results-score {
  opacity: 0;
  transition: opacity 0.5s ease;
}

.results-score.is-visible {
  opacity: 1;
}

.review-quiz-button {
  opacity: 0;
  pointer-events: none;

  transition:
    opacity 0.5s ease,
    background 0.2s ease,
    color 0.2s ease;
}

.review-quiz-button.is-visible {
  opacity: 1;
  pointer-events: auto;
}

/* Review navigation buttons */

.review-navigation-button {
    position: absolute;
    top: 270px;
    width: 54px;
    height: 120px;

    background: #008D8C;
    border: none;
    padding: 0;
    cursor: pointer;

    display: none;
    align-items: center;
    justify-content: center;

    border-radius: 999px;

    z-index: 20;
}

/* Left button */
.review-navigation-left {
    left: -31px;
    border-radius: 0 60px 60px 0;
}

/* Right button */
.review-navigation-right {
    left: 697px;
    border-radius: 60px 0 0 60px;
}

/* Show both navigation buttons throughout review mode. */
.question-screen.is-reviewing .review-navigation-button {
  display: flex;
  visibility: visible;
  pointer-events: auto;
}

/* Keep the unavailable direction visible, but clearly disabled. */

/* No hover, active or focus visual states */
.review-navigation-button:hover,
.review-navigation-button:active,
.review-navigation-button:focus {
  background: #008D8C;
  outline: none;
  box-shadow: none;
}

/* Arrow shapes */
.review-navigation-arrow {
    position: absolute;
    width: 14px;
    height: 14px;
    border-top: 4px solid #fff;
    border-right: 4px solid #fff;
}

.review-navigation-arrow-left {
    left: 38.5px;
    transform: rotate(-135deg);
}

.review-navigation-arrow-right {
    right: 38.5px;
    transform: rotate(45deg);
}

/* Hide Continue during review mode */
.question-screen.is-reviewing .continue-button {
  display: none;
}

/* Remove question entrance animations during review */
.question-screen.is-reviewing .question-part,
.question-screen.is-reviewing .answer-option,
.question-screen.is-reviewing .question-image {
  opacity: 1;
  transition: none;
}

/* Keep the feedback panel visible immediately during review */
.question-screen.is-reviewing .feedback-panel {
  transform: translateX(0);
  transition: none;
}

/* Show feedback content immediately */
.question-screen.is-reviewing .feedback-text,
.question-screen.is-reviewing .feedback-label,
.question-screen.is-reviewing .feedback-avatar {
  opacity: 1;
  transition: none;
}</style></head><body><main class="page-shell"><div id="quizStage" class="quiz-stage">
<section id="startScreen" class="screen start-screen" aria-label="Quiz start screen">
<div class="left-panel" aria-hidden="true"></div><img class="corner-graphic" src="img/CB_icon.png" alt=""><img class="coursebook-logo" src="img/CB_logo.png" alt="CourseBook"><img class="quiz-icon" src="img/quiz_icon.png" alt="">
<div class="quiz-title"><h1>${title}</h1></div><button id="startButton" class="start-button" type="button">Start</button></section>
<section id="questionScreen" class="screen question-screen" aria-label="Quiz question" aria-hidden="true">
<div class="question-number question-part" aria-live="polite"><span id="currentQuestionNumber" class="current-question">1</span><span id="totalQuestions" class="total-questions">/5</span></div>
<div class="question-box"><div id="questionText"></div></div>
<div id="answersList" class="answers-list" role="radiogroup" aria-labelledby="questionText">
<button class="answer-option question-part" type="button" role="radio" aria-checked="false"><span class="custom-radio" aria-hidden="true"></span><div class="answer-text"></div></button>
<button class="answer-option question-part" type="button" role="radio" aria-checked="false"><span class="custom-radio" aria-hidden="true"></span><div class="answer-text"></div></button>
<button class="answer-option question-part" type="button" role="radio" aria-checked="false"><span class="custom-radio" aria-hidden="true"></span><div class="answer-text"></div></button>
<button class="answer-option question-part" type="button" role="radio" aria-checked="false"><span class="custom-radio" aria-hidden="true"></span><div class="answer-text"></div></button></div>
<button id="submitButton" class="submit-button" type="button">SUBMIT</button><img id="questionImage" class="question-image question-part" src="" alt="">
<aside id="feedbackPanel" class="feedback-panel" aria-hidden="true"><div id="feedbackHero" class="feedback-hero"><img id="feedbackAvatar" class="feedback-avatar" src="" alt=""><div id="feedbackLabel" class="feedback-label">CORRECT</div></div><div id="feedbackText" class="feedback-text"></div><button id="continueButton" class="continue-button" type="button">CONTINUE</button></aside>
<button id="reviewPreviousButton" class="review-navigation-button review-navigation-left" type="button" aria-label="Previous review question"><span class="review-navigation-arrow review-navigation-arrow-left" aria-hidden="true"></span></button><button id="reviewNextButton" class="review-navigation-button review-navigation-right" type="button" aria-label="Next review question"><span class="review-navigation-arrow review-navigation-arrow-right" aria-hidden="true"></span></button></section>
<section id="resultsScreen" class="screen results-screen" aria-hidden="true"><div class="results-card"><div class="results-header"><h2>YOUR RESULTS</h2><div id="resultsStars" class="results-stars" aria-label="Quiz score">${'<div class="result-star"><span class="star-grey">★</span><span class="star-fill">★</span></div>'.repeat(5)}</div></div><div class="results-footer"><p id="resultsScore" class="results-score">0/5</p><button id="reviewQuizButton" class="review-quiz-button" type="button">REVIEW QUIZ</button></div></div></section>
</div></main><script>${runtime}<\/script></body></html>`;
}

// ── Platform-compatible export HTML builder ───────────────

function buildStandaloneQuizHtml(exportData, title) {
  const rawTitle = String(title || "Quiz");
  const plainTitle = rawTitle.replace(/<[^>]+>/g, "");
  const safeFilename = exportData.filename || plainTitle.replace(/[^a-zA-Z0-9_-]/g, "_");

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

  const safeQuizData = JSON.stringify(exportData.questions || [])
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  // IMPORTANT: this is the platform-proven V5 runtime. The learner design
  // is applied through CSS only so the platform-facing JavaScript structure
  // remains unchanged.
  const platformTemplate = "<!DOCTYPE html>\n<html>\n<head>\n  <script type=\"module\">import 'https://unpkg.com/mathlive';</script>\n  <title>__EDGE_QUIZ_TITLE_TEXT__</title>\n  <meta name=\"quiz-title\" content=\"__EDGE_QUIZ_TITLE_ATTRIBUTE__\">\n  <meta name=\"quiz-filename\" content=\"__EDGE_QUIZ_FILENAME__\">\n  <meta name=\"quiz-randomize-export\" content=\"__EDGE_RANDOMIZE_EXPORT__\">\n  <meta name=\"quiz-randomize-answers-export\" content=\"__EDGE_RANDOMIZE_ANSWERS_EXPORT__\">\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <style>\n:root {\n  --quiz-scale: 1;\n  --navy: #003770;\n  --title-colour: #00273b;\n  --teal: #008d8c;\n  --correct: #49bd98;\n  --incorrect: #e24b73;\n  --feedback-bg: #bad6e5;\n}\n\n*,\n*::before,\n*::after {\n  box-sizing: border-box;\n}\n\nhtml,\nbody {\n  width: 100%;\n  height: 100%;\n  margin: 0;\n  overflow: hidden;\n  background: #ffffff;\n  color: var(--title-colour);\n  font-family: \"Roboto\", Arial, sans-serif;\n}\n\nbutton {\n  font: inherit;\n}\n\n.slide {\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  width: 720px;\n  height: 540px;\n  display: none;\n  overflow: hidden;\n  background: #ffffff;\n  transform: translate(-50%, -50%) scale(var(--quiz-scale, 1));\n  transform-origin: center center;\n}\n\n.slide.active {\n  display: block;\n}\n\n/* =========================================================\n   TITLE SCREEN\n   The HTML structure and platform runtime remain unchanged.\n   The current design is applied with CSS and PNG backgrounds.\n   ========================================================= */\n\n.title-slide.active {\n  display: block;\n  background: #ffffff;\n}\n\n.title-slide .left-panel {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: 193px;\n  height: 540px;\n  overflow: hidden;\n  background: var(--navy);\n}\n\n.title-slide .left-panel::before {\n  content: \"\";\n  position: absolute;\n  left: -160px;\n  top: -105px;\n  width: 354px;\n  height: 322px;\n  background: url(\"img/CB_icon.png\") center / contain no-repeat;\n  transform: scaleX(-1) rotate(60deg);\n  transform-origin: center center;\n}\n\n.title-slide .stripe {\n  display: none;\n}\n\n.title-slide .coursebook {\n  position: absolute;\n  left: 24px;\n  top: 478px;\n  bottom: auto;\n  width: 139px;\n  height: 34px;\n  overflow: hidden;\n  background: url(\"img/CB_logo.png\") center / contain no-repeat;\n  color: transparent;\n  font-size: 0;\n  letter-spacing: 0;\n}\n\n.title-content {\n  position: absolute;\n  inset: 0;\n  display: block;\n  padding: 0;\n}\n\n.title-content .quiz-icon {\n  position: absolute;\n  left: 419px;\n  top: 106px;\n  width: 74px;\n  height: 74px;\n  margin: 0;\n  border-radius: 0;\n  background: url(\"img/quiz_icon.png\") center / contain no-repeat;\n  color: transparent;\n  font-size: 0;\n}\n\n.title-content h1 {\n  position: absolute;\n  left: 215px;\n  top: 181px;\n  width: 483px;\n  max-width: none;\n  height: 236px;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  overflow: hidden;\n  color: var(--title-colour);\n  font-size: 40px;\n  font-weight: 500;\n  line-height: 1.1;\n  text-align: center;\n  overflow-wrap: anywhere;\n}\n\n.title-content > button {\n  position: absolute;\n  left: 391px;\n  top: 420px;\n  width: 130px;\n  height: 32px;\n  margin: 0;\n  padding: 0;\n  border: 2px solid var(--navy);\n  border-radius: 6px;\n  background: var(--navy);\n  color: #ffffff;\n  font-size: 16px;\n  font-weight: 400;\n  line-height: 28px;\n  text-align: center;\n  cursor: pointer;\n}\n\n.title-content > button:hover,\n.title-content > button:focus-visible {\n  background: #ffffff;\n  color: var(--navy);\n  outline: none;\n}\n\n/* =========================================================\n   QUESTION SCREEN\n   ========================================================= */\n\n.question-slide.active {\n  position: absolute;\n  display: block;\n  background: #ffffff;\n}\n\n.question-left {\n  position: absolute;\n  inset: 0;\n  width: 720px;\n  height: 540px;\n  min-width: 0;\n  padding: 0;\n  display: block;\n}\n\n.counter {\n  position: absolute;\n  left: 3px;\n  top: 3px;\n  width: 35px;\n  height: 27px;\n  margin: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: var(--teal);\n  font-size: 14.67px;\n  font-weight: 300;\n  line-height: 1;\n  white-space: nowrap;\n}\n\n.question-box {\n  position: absolute;\n  left: 30px;\n  top: 30px;\n  width: 426px;\n  height: 140px;\n  min-height: 0;\n  margin: 0;\n  padding: 5px 15px;\n  display: flex;\n  align-items: center;\n  justify-content: flex-start;\n  overflow: hidden;\n  border-radius: 17px;\n  background: #ebeff3;\n  color: var(--title-colour);\n  font-size: 14.67px;\n  font-weight: 300;\n  line-height: 1.2;\n  overflow-wrap: anywhere;\n}\n\n.question-box p,\n.answer-card > div:last-child p,\n.feedback-text p {\n  margin: 0;\n}\n\n.question-box ul,\n.question-box ol,\n.answer-card > div:last-child ul,\n.answer-card > div:last-child ol,\n.feedback-text ul,\n.feedback-text ol {\n  margin: 0;\n  padding-left: 1.35em;\n}\n\n#answersContainer {\n  position: absolute;\n  inset: 0;\n  display: block;\n  min-height: 0;\n}\n\n.answer-card {\n  position: absolute;\n  left: 31px;\n  width: 426px;\n  height: 70px;\n  min-height: 0;\n  margin: 0;\n  padding: 5px 10px 5px 25px;\n  display: flex;\n  align-items: center;\n  overflow: hidden;\n  border: 0 solid transparent;\n  border-radius: 17px;\n  background: #cce8e8;\n  color: var(--teal);\n  font-size: 13.33px;\n  font-weight: 300;\n  line-height: 1.2;\n  text-align: left;\n  cursor: pointer;\n  transition: background 0.2s ease, color 0.2s ease, border 0.2s ease;\n  overflow-wrap: anywhere;\n}\n\n.answer-card:nth-child(1) { top: 185px; }\n.answer-card:nth-child(2) { top: 260px; }\n.answer-card:nth-child(3) { top: 335px; }\n.answer-card:nth-child(4) { top: 410px; }\n\n.answer-card > div:last-child {\n  flex: 1;\n  min-width: 0;\n  max-height: 60px;\n  overflow: hidden;\n  overflow-wrap: anywhere;\n}\n\n.radio-circle {\n  position: relative;\n  flex: 0 0 auto;\n  width: 30px;\n  height: 30px;\n  margin-right: 18px;\n  border: 4px solid #aebfc0;\n  border-radius: 50%;\n  background: #ffffff;\n}\n\n.answer-card:hover:not(.disabled):not(.correct):not(.incorrect):not(.correct-border),\n.answer-card.selected {\n  background: #f6e6c3;\n  color: #cc9716;\n}\n\n.answer-card.selected .radio-circle {\n  border-color: rgba(0, 0, 0, 0.8);\n  background: #e9e9e9;\n}\n\n.answer-card.selected .radio-circle::after {\n  content: \"\";\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  width: 14px;\n  height: 14px;\n  border-radius: 50%;\n  background: #e6bc48;\n  transform: translate(-50%, -50%);\n}\n\n.answer-card.correct {\n  background: var(--correct);\n  color: #ffffff;\n}\n\n.answer-card.incorrect {\n  background: var(--incorrect);\n  color: #ffffff;\n}\n\n.answer-card.correct-border {\n  border-width: 2px;\n  border-color: var(--correct);\n  background: #e4f5f0;\n  color: var(--correct);\n}\n\n.answer-card.disabled {\n  background: #ebeff3;\n  color: #9fb2bd;\n  cursor: default;\n}\n\n.submit-btn,\n.continue-btn,\n.review-btn {\n  margin: 0;\n  padding: 0;\n  border: 2px solid var(--teal);\n  border-radius: 18px;\n  background: var(--teal);\n  color: #ffffff;\n  font-size: 16px;\n  font-weight: 400;\n  text-align: center;\n  cursor: pointer;\n}\n\n.submit-btn:hover,\n.submit-btn:focus-visible,\n.continue-btn:hover,\n.continue-btn:focus-visible,\n.review-btn:hover,\n.review-btn:focus-visible {\n  background: #ffffff;\n  color: var(--teal);\n  outline: none;\n}\n\n.submit-btn {\n  position: absolute;\n  left: 180px;\n  top: 498px;\n  width: 140px;\n  height: 30px;\n  line-height: 26px;\n  display: none;\n}\n\n.question-right {\n  position: absolute;\n  inset: 0;\n  width: 720px;\n  height: 540px;\n  min-width: 0;\n  pointer-events: none;\n}\n\n.image-placeholder {\n  position: absolute;\n  left: 495px;\n  top: 40px;\n  width: 195px;\n  height: 470px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  overflow: hidden;\n  background: transparent;\n  color: #8aa7b5;\n  font-size: 16px;\n}\n\n.question-image {\n  width: 195px;\n  height: 470px;\n  object-fit: contain;\n  background: transparent;\n}\n\n/* =========================================================\n   FEEDBACK PANEL\n   ========================================================= */\n\n.feedback-panel {\n  position: absolute;\n  left: 486px;\n  top: -1px;\n  width: 241px;\n  height: 541px;\n  padding: 0;\n  overflow: hidden;\n  display: block;\n  visibility: hidden;\n  pointer-events: none;\n  background: var(--feedback-bg);\n  transform: translateX(105%);\n  transition: transform 0.5s ease-out;\n}\n\n.feedback-panel.show {\n  display: block;\n  visibility: visible;\n  pointer-events: auto;\n  transform: translateX(0);\n}\n\n.feedback-image {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: 241px;\n  height: 214px;\n  margin: 0;\n  display: block;\n}\n\n.feedback-img {\n  position: absolute;\n  left: 22px;\n  top: 35px;\n  width: 189px;\n  height: 165px;\n  max-width: none;\n  max-height: none;\n  object-fit: contain;\n}\n\n.feedback-badge {\n  position: absolute;\n  left: 43px;\n  top: 184px;\n  width: 146px;\n  height: 30px;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border-radius: 18px;\n  color: #ffffff;\n  font-size: 16px;\n  font-weight: 400;\n  line-height: 1;\n  letter-spacing: 0;\n}\n\n.feedback-badge.correct {\n  background: var(--correct);\n}\n\n.feedback-badge.incorrect {\n  background: var(--incorrect);\n}\n\n.feedback-text {\n  position: absolute;\n  left: 23px;\n  top: 230px;\n  width: 188px;\n  height: 250px;\n  margin: 0;\n  overflow: hidden;\n  color: var(--title-colour);\n  font-size: 14px;\n  font-weight: 300;\n  line-height: 1.2;\n  overflow-wrap: anywhere;\n}\n\n.continue-btn {\n  position: absolute;\n  left: 59px;\n  top: 498px;\n  bottom: auto;\n  width: 118px;\n  height: 30px;\n  line-height: 26px;\n  transform: none;\n  display: block;\n}\n\n/* =========================================================\n   RESULTS SCREEN\n   ========================================================= */\n\n.results-slide.active {\n  display: block;\n  background: #ffffff;\n}\n\n.results-card {\n  position: absolute;\n  left: 183px;\n  top: 159px;\n  width: 355px;\n  height: 224px;\n  text-align: center;\n}\n\n.results-top {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: 355px;\n  height: 127px;\n  padding: 0;\n  background: var(--teal);\n  color: #ffffff;\n}\n\n.results-top h2 {\n  position: absolute;\n  left: 0;\n  top: 9px;\n  width: 355px;\n  margin: 0;\n  color: #ffffff;\n  font-size: 18.67px;\n  font-weight: 400;\n  line-height: 1;\n  letter-spacing: 3px;\n  text-align: center;\n}\n\n.stars {\n  position: absolute;\n  left: 20px;\n  top: 43px;\n  width: 315px;\n  height: 57px;\n  display: flex;\n  align-items: flex-start;\n  justify-content: flex-start;\n  gap: 2px;\n  font-size: 0;\n}\n\n.star {\n  position: relative;\n  display: inline-block;\n  flex: 0 0 61px;\n  width: 61px;\n  height: 57px;\n  overflow: hidden;\n  color: #dae0e4;\n  font-family: Arial, sans-serif;\n  font-size: 70px;\n  line-height: 1;\n  text-align: left;\n  transform: translateY(-8px);\n}\n\n/* The grey star is always present. Yellow is drawn over it so the\n   yellow portion can animate without hiding the grey base. */\n.star.full,\n.star.half {\n  color: #dae0e4;\n}\n\n.star.full::before,\n.star.half::before {\n  content: \"★\";\n  position: absolute;\n  left: 0;\n  top: 0;\n  overflow: hidden;\n  color: #e6ba46;\n  white-space: nowrap;\n  opacity: 1;\n  transform: scale(1);\n  transform-origin: center center;\n}\n\n.star.full::before {\n  width: 100%;\n}\n\n.star.half::before {\n  width: 50%;\n}\n\n.results-bottom {\n  position: absolute;\n  left: 0;\n  top: 127px;\n  width: 355px;\n  height: 97px;\n  padding: 0;\n  background: #cce7f1;\n}\n\n.score-display {\n  position: absolute;\n  left: 0;\n  top: 26px;\n  width: 355px;\n  margin: 0;\n  color: #018d8c;\n  font-size: 21.33px;\n  font-weight: 400;\n  line-height: 1;\n  text-align: center;\n}\n\n.review-btn {\n  position: absolute;\n  left: 104px;\n  top: 57px;\n  width: 147px;\n  height: 30px;\n  line-height: 26px;\n}\n\n/* =========================================================\n   REVIEW NAVIGATION\n   ========================================================= */\n\n#reviewNav {\n  display: contents;\n}\n\n.review-arrow {\n  position: absolute;\n  top: 270px;\n  width: 54px;\n  height: 120px;\n  padding: 0;\n  border: 0;\n  background: var(--teal);\n  color: transparent;\n  font-size: 0;\n  font-weight: 400;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  z-index: 20;\n  transform: none;\n}\n\n.review-arrow.left {\n  left: -31px;\n  border-radius: 0 60px 60px 0;\n}\n\n.review-arrow.right {\n  left: 697px;\n  border-radius: 60px 0 0 60px;\n}\n\n.review-arrow::before {\n  content: \"\";\n  position: absolute;\n  width: 14px;\n  height: 14px;\n  border-top: 4px solid #ffffff;\n  border-right: 4px solid #ffffff;\n}\n\n.review-arrow.left::before {\n  left: 38.5px;\n  transform: rotate(-135deg);\n}\n\n.review-arrow.right::before {\n  right: 38.5px;\n  transform: rotate(45deg);\n}\n\n.review-arrow:hover,\n.review-arrow:active,\n.review-arrow:focus {\n  background: var(--teal);\n  outline: none;\n  box-shadow: none;\n}\n\n\n/* =========================================================\n   PREVIEW-PARITY STATE LAYER\n   The V8 platform shell is preserved. These state classes mirror the\n   working Preview timing and prevent completed animations from replaying.\n   ========================================================= */\n\n/* Title screen exits completely before the learner sees Question 1. */\n.title-slide.is-exiting {\n  z-index: 10;\n  pointer-events: none;\n  animation: edgeTitleExit 1.5s ease-in-out both;\n}\n\n@keyframes edgeTitleExit {\n  from { left: 50%; opacity: 1; }\n  to   { left: -50%; opacity: 1; }\n}\n\n/* Question entrance: number first, then answers and image together. */\n.counter,\n.answer-card,\n.image-placeholder {\n  opacity: 0;\n  transition: opacity 0.4s ease;\n}\n\n.question-slide.question-visible .counter {\n  opacity: 1;\n}\n\n.question-slide.question-ready .answer-card,\n.question-slide.question-ready .image-placeholder {\n  opacity: 1;\n}\n\n.question-slide.is-resetting .counter,\n.question-slide.is-resetting .answer-card,\n.question-slide.is-resetting .image-placeholder {\n  opacity: 0 !important;\n  transition: none !important;\n}\n\n/* Submit remains in its design position and fades in after selection. */\n.submit-btn {\n  left: 198.5px;\n  width: 103px;\n  display: block;\n  opacity: 0;\n  pointer-events: none;\n  transition: opacity 0.5s ease, background 0.2s ease, color 0.2s ease;\n}\n\n.submit-btn.is-visible {\n  opacity: 1;\n  pointer-events: auto;\n}\n\n/* Feedback panel slides first; details then fade in. */\n.feedback-text,\n.continue-btn {\n  opacity: 0;\n  transition: opacity 0.5s ease;\n}\n\n.continue-btn {\n  pointer-events: none;\n}\n\n.feedback-panel.show-details .feedback-text,\n.feedback-panel.show-details .continue-btn {\n  opacity: 1;\n}\n\n.feedback-panel.show-details .continue-btn {\n  pointer-events: auto;\n}\n\n/* Results match Preview: grey stars exist immediately and yellow overlays\n   animate once. Score follows, then Review Quiz. */\n.stars {\n  position: absolute;\n  left: 20px;\n  top: 43px;\n  width: 315px;\n  height: 57px;\n  display: block;\n  font-size: 0;\n}\n\n.star {\n  position: absolute;\n  top: 0;\n  width: 61px;\n  height: 57px;\n  overflow: hidden;\n  transform: none;\n}\n\n.star:nth-child(1) { left: 0; }\n.star:nth-child(2) { left: 63px; }\n.star:nth-child(3) { left: 126px; }\n.star:nth-child(4) { left: 189px; }\n.star:nth-child(5) { left: 252px; }\n\n.star-grey,\n.star-fill {\n  position: absolute;\n  left: 0;\n  top: -8px;\n  display: block;\n  width: 61px;\n  height: 65px;\n  font-family: Arial, sans-serif;\n  font-size: 70px;\n  line-height: 1;\n  text-align: center;\n  white-space: nowrap;\n  user-select: none;\n}\n\n.star-grey {\n  color: #dae0e4;\n}\n\n.star-fill {\n  width: 61px;\n  overflow: hidden;\n  clip-path: inset(0 100% 0 0);\n  color: #e6ba46;\n  opacity: 0;\n  transform: scale(0);\n  transform-origin: center center;\n  transition: transform 0.25s ease-out, opacity 0.25s ease-out;\n}\n\n.star-fill.is-visible {\n  opacity: 1;\n  transform: scale(1);\n}\n\n.score-display {\n  top: 18px;\n  opacity: 0;\n  transition: opacity 0.5s ease;\n}\n\n.score-display.is-visible {\n  opacity: 1;\n}\n\n.review-btn {\n  opacity: 0;\n  pointer-events: none;\n  transition: opacity 0.5s ease, background 0.2s ease, color 0.2s ease;\n}\n\n.review-btn.is-visible {\n  opacity: 1;\n  pointer-events: auto;\n}\n\n/* Preserve current answer styling. */\n.answer-card.selected .radio-circle {\n  border-color: #aebfc0;\n  background: #ffffff;\n}\n\n.answer-card.correct-border {\n  border: 0;\n  box-shadow: inset 0 0 0 2px var(--correct);\n}\n\n/* Keep answer cards clickable beneath the right-side layer. */\n.question-right {\n  pointer-events: none;\n}\n\n.feedback-panel.show {\n  pointer-events: auto;\n}\n\n/* Review navigation uses the same 720 x 540 design coordinates as Preview. */\n#reviewNav {\n  display: contents;\n}\n\n.review-arrow {\n  position: absolute;\n  top: 270px;\n  width: 54px;\n  height: 120px;\n  padding: 0;\n  border: 0;\n  background: var(--teal);\n  color: transparent;\n  font-size: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  z-index: 20;\n  transform: none;\n}\n\n.review-arrow.left {\n  left: -31px;\n  border-radius: 0 60px 60px 0;\n}\n\n.review-arrow.right {\n  left: 697px;\n  border-radius: 60px 0 0 60px;\n}\n\n.review-arrow::before {\n  content: \"\";\n  position: absolute;\n  width: 14px;\n  height: 14px;\n  border-top: 4px solid #ffffff;\n  border-right: 4px solid #ffffff;\n}\n\n.review-arrow.left::before {\n  left: 38.5px;\n  transform: rotate(-135deg);\n}\n\n.review-arrow.right::before {\n  right: 38.5px;\n  transform: rotate(45deg);\n}\n\n.review-arrow:hover,\n.review-arrow:active,\n.review-arrow:focus {\n  background: var(--teal);\n  outline: none;\n  box-shadow: none;\n}\n\n/* Review is a final, static inspection state. */\n.question-slide.is-reviewing .counter,\n.question-slide.is-reviewing .answer-card,\n.question-slide.is-reviewing .image-placeholder,\n.question-slide.is-reviewing .feedback-text {\n  opacity: 1 !important;\n  animation: none !important;\n  transition: none !important;\n}\n\n.question-slide.is-reviewing .feedback-panel {\n  visibility: visible;\n  transform: translateX(0) !important;\n  animation: none !important;\n  transition: none !important;\n}\n\n.question-slide.is-reviewing .continue-btn {\n  display: none !important;\n}\n\n  </style>\n</head>\n<body>\n\n  <section id=\"titleSlide\" class=\"slide title-slide active\">\n    <div class=\"left-panel\">\n      <div class=\"stripe pink\"></div>\n      <div class=\"stripe orange\"></div>\n      <div class=\"stripe blue\"></div>\n      <div class=\"coursebook\">CourseBook</div>\n    </div>\n    <div class=\"title-content\">\n      <div class=\"quiz-icon\">☑</div>\n      <h1>__EDGE_QUIZ_TITLE_HTML__</h1>\n      <button onclick=\"startQuiz()\">Start</button>\n    </div>\n  </section>\n\n  <section id=\"questionSlide\" class=\"slide question-slide\">\n    <div class=\"question-left\">\n      <div class=\"counter\" id=\"counter\"></div>\n      <div class=\"question-box\" id=\"questionText\"></div>\n      <div id=\"answersContainer\"></div>\n      <button id=\"submitBtn\" class=\"submit-btn\" onclick=\"submitAnswer()\">SUBMIT</button>\n    </div>\n    <div class=\"question-right\">\n      <div id=\"questionImage\" class=\"image-placeholder\">\n        <img id=\"questionImageEl\" class=\"question-image\" src=\"\" alt=\"Question image\">\n      </div>\n      <div id=\"feedbackPanel\" class=\"feedback-panel\">\n        <div class=\"feedback-image\"><img id=\"feedbackImageEl\" class=\"feedback-img\" src=\"\" alt=\"Feedback image\"></div>\n        <div id=\"feedbackBadge\" class=\"feedback-badge\"></div>\n        <div id=\"feedbackText\" class=\"feedback-text\"></div>\n        <button id=\"continueBtn\" class=\"continue-btn\" onclick=\"continueQuiz()\">CONTINUE</button>\n      </div>\n    </div>\n  </section>\n\n  <section id=\"resultsSlide\" class=\"slide results-slide\">\n    <div class=\"results-card\">\n      <div class=\"results-top\">\n        <h2>YOUR RESULTS</h2>\n        <div class=\"stars\" id=\"starsContainer\"></div>\n      </div>\n      <div class=\"results-bottom\">\n        <div id=\"scoreDisplay\" class=\"score-display\"></div>\n        <button class=\"review-btn\" onclick=\"reviewQuiz()\">REVIEW QUIZ</button>\n      </div>\n    </div>\n  </section>\n\n  <script>\n    const originalQuizData = __EDGE_QUIZ_DATA__;\n    const RANDOMIZE_QUESTIONS = __EDGE_RANDOMIZE_QUESTIONS__;\n    const RANDOMIZE_ANSWERS = __EDGE_RANDOMIZE_ANSWERS__;\n    let activeQuiz = [], currentQuestionIndex = 0, selectedAnswerIndex = null;\n\n    // Storyline-style responsive player scaling: preserve the 720 × 540\n    // design canvas while filling as much of the browser as possible.\n    function scaleQuizToViewport() {\n      const PLAYER_MARGIN = 10;\n      const availableWidth = Math.max(1, window.innerWidth - (PLAYER_MARGIN * 2));\n      const availableHeight = Math.max(1, window.innerHeight - (PLAYER_MARGIN * 2));\n      const scale = Math.min(availableWidth / 720, availableHeight / 540);\n      document.documentElement.style.setProperty(\"--quiz-scale\", String(scale));\n    }\n      \n\n    window.addEventListener(\"resize\", scaleQuizToViewport);\n    window.addEventListener(\"orientationchange\", scaleQuizToViewport);\n    scaleQuizToViewport();\n    let score = 0, submitted = false, reviewMode = false, userAnswers = [], completedFired = false, resultsHaveBeenShown = false, quizHasStarted = false;\n    const START_EXIT_DURATION = 1500, ANSWER_FADE_DELAY = 400, FEEDBACK_DURATION = 500, STAR_STEP_DURATION = 250;\n\n    function shuffleArray(arr) { return [...arr].sort(() => Math.random() - 0.5); }\n\n    // Available question images (sit in the img/ folder next to this file)\n    const QUIZ_IMAGES = [\n      \"img/image1.png\",\n      \"img/image2.png\",\n      \"img/image3.png\",\n      \"img/image4.png\",\n      \"img/image5.png\"\n    ];\n\n    // Feedback images: 5 for correct, 5 for incorrect\n    const CORRECT_IMAGES = [\n      \"img/correct1.png\",\n      \"img/correct2.png\",\n      \"img/correct3.png\",\n      \"img/correct4.png\",\n      \"img/correct5.png\"\n    ];\n    const INCORRECT_IMAGES = [\n      \"img/incorrect1.png\",\n      \"img/incorrect2.png\",\n      \"img/incorrect3.png\",\n      \"img/incorrect4.png\",\n      \"img/incorrect5.png\"\n    ];\n\n    const feedbackImagePromises = new Map();\n    let feedbackSequence = 0;\n\n    function preloadFeedbackImage(src) {\n      if (!src) return Promise.resolve();\n      if (!feedbackImagePromises.has(src)) {\n        feedbackImagePromises.set(src, new Promise(resolve => {\n          const image = new Image();\n          const finish = () => {\n            if (typeof image.decode === \"function\") {\n              image.decode().then(resolve).catch(resolve);\n            } else {\n              resolve();\n            }\n          };\n          image.onload = finish;\n          image.onerror = resolve;\n          image.src = src;\n        }));\n      }\n      return feedbackImagePromises.get(src);\n    }\n\n    [...CORRECT_IMAGES, ...INCORRECT_IMAGES].forEach(preloadFeedbackImage);\n\n    // Shuffled queues + pointers, set up at quiz start\n    let correctQueue = [], incorrectQueue = [];\n    let correctPtr = 0, incorrectPtr = 0;\n\n    // Pull the next feedback image, cycling through a shuffled queue.\n    // Re-shuffles when exhausted, avoiding an immediate repeat at the seam.\n    function nextFeedbackImage(isCorrect) {\n      if (isCorrect) {\n        if (correctPtr >= correctQueue.length) {\n          const last = correctQueue[correctQueue.length - 1];\n          do { correctQueue = shuffleArray(CORRECT_IMAGES); }\n          while (correctQueue.length > 1 && correctQueue[0] === last);\n          correctPtr = 0;\n        }\n        return correctQueue[correctPtr++];\n      } else {\n        if (incorrectPtr >= incorrectQueue.length) {\n          const last = incorrectQueue[incorrectQueue.length - 1];\n          do { incorrectQueue = shuffleArray(INCORRECT_IMAGES); }\n          while (incorrectQueue.length > 1 && incorrectQueue[0] === last);\n          incorrectPtr = 0;\n        }\n        return incorrectQueue[incorrectPtr++];\n      }\n    }\n\n    /**\n     * Assign one image per question.\n     * - If questions <= images: each image used at most once (no repeats).\n     * - If questions > images: images repeat as evenly as possible, but the\n     *   same image never appears on two consecutive questions.\n     */\n    function assignImages(count) {\n      const imgCount = QUIZ_IMAGES.length;\n\n      // Simple case: enough unique images, just shuffle and slice\n      if (count <= imgCount) {\n        return shuffleArray(QUIZ_IMAGES).slice(0, count);\n      }\n\n      // Build a pool where each image appears the needed number of times\n      const pool = [];\n      let i = 0;\n      while (pool.length < count) {\n        pool.push(QUIZ_IMAGES[i % imgCount]);\n        i++;\n      }\n\n      // Shuffle, then fix any adjacent duplicates by swapping forward\n      let result = shuffleArray(pool);\n      for (let attempt = 0; attempt < 50; attempt++) {\n        let clean = true;\n        for (let j = 1; j < result.length; j++) {\n          if (result[j] === result[j - 1]) {\n            // find a later item that differs from both neighbours, swap it in\n            let swapped = false;\n            for (let k = j + 1; k < result.length; k++) {\n              if (result[k] !== result[j - 1] &&\n                  (j + 1 >= result.length || result[k] !== result[j + 1])) {\n                [result[j], result[k]] = [result[k], result[j]];\n                swapped = true;\n                break;\n              }\n            }\n            if (!swapped) clean = false;\n          }\n        }\n        if (clean) break;\n        result = shuffleArray(pool); // reshuffle and retry if stuck\n      }\n      return result;\n    }\n\n    function shuffleQuestions(questions) {\n      let shuffled = shuffleArray(questions);\n\n      if (questions.length === 5) {\n        const firstQuestion = questions[0];\n        const fifthQuestion = questions[4];\n        let guard = 0;\n\n        while (\n          Math.abs(shuffled.indexOf(firstQuestion) - shuffled.indexOf(fifthQuestion)) === 1 &&\n          guard++ < 50\n        ) {\n          shuffled = shuffleArray(questions);\n        }\n      }\n\n      return shuffled;\n    }\n\n    function startQuiz() {\n      if (quizHasStarted) return;\n      quizHasStarted = true;\n      if (typeof started === \"function\") started();\n      const imageOrder = assignImages(originalQuizData.length);\n      const orderedQuestions = RANDOMIZE_QUESTIONS\n        ? shuffleQuestions(originalQuizData)\n        : [...originalQuizData];\n      activeQuiz = orderedQuestions.map((q, idx) => ({\n        ...q,\n        answers: RANDOMIZE_ANSWERS\n          ? shuffleArray(q.answers.map((a, i) => ({ text: a, isCorrect: i === q.correctIndex })))\n          : q.answers.map((a, i) => ({ text: a, isCorrect: i === q.correctIndex }))\n      }));\n      activeQuiz.forEach((q, idx) => { q.image = imageOrder[idx]; });\n      currentQuestionIndex = 0; selectedAnswerIndex = null;\n      score = 0; submitted = false; reviewMode = false; userAnswers = [];\n      completedFired = false; resultsHaveBeenShown = false;\n      correctQueue = shuffleArray(CORRECT_IMAGES); correctPtr = 0;\n      incorrectQueue = shuffleArray(INCORRECT_IMAGES); incorrectPtr = 0;\n      removeReviewNavigation();\n\n      // Prepare Question 1 while it is still hidden. The title remains the\n      // only active slide until its complete 1.5 second exit has finished.\n      renderQuestion(true);\n      const titleSlide = document.getElementById(\"titleSlide\");\n      titleSlide.classList.add(\"is-exiting\");\n\n      setTimeout(() => {\n        showSlide(\"questionSlide\");\n        const questionSlide = document.getElementById(\"questionSlide\");\n        questionSlide.classList.add(\"question-visible\");\n        setTimeout(() => questionSlide.classList.add(\"question-ready\"), ANSWER_FADE_DELAY);\n      }, START_EXIT_DURATION);\n    }\n\n    function showSlide(id) {\n      document.querySelectorAll(\".slide\").forEach(s => s.classList.remove(\"active\"));\n      document.getElementById(id).classList.add(\"active\");\n    }\n\n    function renderQuestion(isInitial = false) {\n      const q = activeQuiz[currentQuestionIndex];\n      const questionSlide = document.getElementById(\"questionSlide\");\n      questionSlide.classList.add(\"is-resetting\");\n      questionSlide.classList.remove(\"is-reviewing\", \"question-visible\", \"question-ready\");\n      selectedAnswerIndex = null; submitted = false;\n      document.getElementById(\"counter\").textContent = `${currentQuestionIndex + 1}/${activeQuiz.length}`;\n      document.getElementById(\"questionText\").innerHTML = q.question;\n      document.getElementById(\"submitBtn\").classList.remove(\"is-visible\");\n      feedbackSequence++;\n      document.getElementById(\"feedbackPanel\").classList.remove(\"show\", \"show-details\");\n      document.getElementById(\"feedbackImageEl\").style.visibility = \"hidden\";\n      document.getElementById(\"questionImage\").style.display = \"flex\";\n      document.getElementById(\"questionImageEl\").src = q.image || \"\";\n\n      const container = document.getElementById(\"answersContainer\");\n      container.innerHTML = \"\";\n      q.answers.forEach((answer, i) => {\n        const card = document.createElement(\"div\");\n        card.className = \"answer-card\";\n        card.onclick = () => selectAnswer(i);\n        card.innerHTML = `<div class=\"radio-circle\"></div><div>${answer.text}</div>`;\n        container.appendChild(card);\n      });\n\n      void questionSlide.offsetWidth;\n      questionSlide.classList.remove(\"is-resetting\");\n\n      // The first question is prepared while hidden and is revealed by\n      // startQuiz() only after the title screen has completely left.\n      if (!isInitial) {\n        questionSlide.classList.add(\"question-visible\");\n        setTimeout(() => questionSlide.classList.add(\"question-ready\"), ANSWER_FADE_DELAY);\n      }\n    }\n\n    function selectAnswer(index) {\n      if (submitted || reviewMode) return;\n      selectedAnswerIndex = index;\n      document.querySelectorAll(\".answer-card\").forEach((c, i) => c.classList.toggle(\"selected\", i === index));\n      document.getElementById(\"submitBtn\").classList.add(\"is-visible\");\n    }\n\n    function submitAnswer() {\n      if (selectedAnswerIndex === null) return;\n      submitted = true;\n      const q = activeQuiz[currentQuestionIndex];\n      const answer = q.answers[selectedAnswerIndex];\n      const isCorrect = answer.isCorrect;\n      if (isCorrect) score++;\n      const fbImage = nextFeedbackImage(isCorrect);\n      userAnswers[currentQuestionIndex] = { selectedAnswerIndex, isCorrect, fbImage };\n      const submitBtn = document.getElementById(\"submitBtn\");\n      submitBtn.style.transition = \"none\";\n      submitBtn.classList.remove(\"is-visible\");\n      void submitBtn.offsetWidth;\n      submitBtn.style.transition = \"\";\n      document.getElementById(\"questionImage\").style.display = \"none\";\n      renderSubmittedState(q, selectedAnswerIndex, isCorrect, false, fbImage);\n    }\n\n    async function renderSubmittedState(q, selectedIndex, isCorrect, isReview, fbImage) {\n      document.querySelectorAll(\".answer-card\").forEach((card, i) => {\n        const a = q.answers[i];\n        card.onclick = null;\n        card.classList.remove(\"selected\");\n        if (a.isCorrect && isCorrect)       card.classList.add(\"correct\");\n        else if (a.isCorrect && !isCorrect) card.classList.add(\"correct-border\");\n        else if (i === selectedIndex && !isCorrect) card.classList.add(\"incorrect\");\n        else card.classList.add(\"disabled\");\n      });\n\n      const badge = document.getElementById(\"feedbackBadge\");\n      badge.textContent = isCorrect ? \"CORRECT\" : \"INCORRECT\";\n      badge.className = \"feedback-badge \" + (isCorrect ? \"correct\" : \"incorrect\");\n      document.getElementById(\"feedbackText\").innerHTML = q.feedback || \"No feedback added.\";\n\n      const panel = document.getElementById(\"feedbackPanel\");\n      const image = document.getElementById(\"feedbackImageEl\");\n      const continueButton = document.getElementById(\"continueBtn\");\n      const sequence = ++feedbackSequence;\n      const imageSource = fbImage || \"\";\n\n      panel.classList.remove(\"show\", \"show-details\");\n      image.style.visibility = \"hidden\";\n      continueButton.style.display = isReview ? \"none\" : \"block\";\n\n      await preloadFeedbackImage(imageSource);\n      if (sequence !== feedbackSequence) return;\n\n      image.src = imageSource;\n      image.style.visibility = \"visible\";\n      panel.classList.add(\"show\");\n\n      if (isReview) {\n        panel.classList.add(\"show-details\");\n      } else {\n        setTimeout(() => {\n          if (sequence === feedbackSequence) panel.classList.add(\"show-details\");\n        }, FEEDBACK_DURATION);\n      }\n    }\n\n    function continueQuiz() {\n      currentQuestionIndex++;\n      if (currentQuestionIndex >= activeQuiz.length) showResults();\n      else renderQuestion(false);\n    }\n\n    function showResults() {\n      removeReviewNavigation();\n      const questionSlide = document.getElementById(\"questionSlide\");\n      questionSlide.classList.remove(\"is-reviewing\", \"question-visible\", \"question-ready\");\n      showSlide(\"resultsSlide\");\n      const scoreDisplay = document.getElementById(\"scoreDisplay\");\n      const reviewButton = document.querySelector(\".review-btn\");\n      scoreDisplay.textContent = `${score}/${activeQuiz.length}`;\n      const shouldAnimate = !resultsHaveBeenShown;\n      scoreDisplay.classList.toggle(\"is-visible\", !shouldAnimate);\n      reviewButton.classList.toggle(\"is-visible\", !shouldAnimate);\n      const animatedStarCount = renderStars(score, activeQuiz.length, shouldAnimate);\n      if (shouldAnimate) {\n        const scoreDelay = animatedStarCount * STAR_STEP_DURATION;\n        setTimeout(() => {\n          scoreDisplay.classList.add(\"is-visible\");\n          setTimeout(() => reviewButton.classList.add(\"is-visible\"), FEEDBACK_DURATION);\n        }, scoreDelay);\n      }\n      resultsHaveBeenShown = true;\n      if (!completedFired) {\n        completedFired = true;\n        const percentage = Math.round((score / activeQuiz.length) * 100);\n        if (typeof completed === \"function\") completed(percentage);\n      }\n    }\n\n    function renderStars(score, total, animate) {\n      const container = document.getElementById(\"starsContainer\");\n      container.innerHTML = \"\";\n      const starScore = total > 0 ? (score / total) * 5 : 0;\n      const visibleFills = [];\n      for (let i = 0; i < 5; i++) {\n        const fillAmount = Math.max(0, Math.min(1, starScore - i));\n        const star = document.createElement(\"span\");\n        star.className = \"star\";\n        star.innerHTML = `<span class=\"star-grey\">★</span><span class=\"star-fill\">★</span>`;\n        const fill = star.querySelector(\".star-fill\");\n        fill.style.clipPath = `inset(0 ${(1 - fillAmount) * 100}% 0 0)`;\n        if (fillAmount > 0) visibleFills.push(fill);\n        if (!animate) fill.classList.add(\"is-visible\");\n        container.appendChild(star);\n      }\n      if (animate) {\n        visibleFills.forEach((fill, index) => {\n          setTimeout(() => fill.classList.add(\"is-visible\"), index * STAR_STEP_DURATION);\n        });\n      }\n      return visibleFills.length;\n    }\n\n    function reviewQuiz() {\n      reviewMode = true; currentQuestionIndex = 0;\n      const questionSlide = document.getElementById(\"questionSlide\");\n      questionSlide.classList.add(\"is-reviewing\");\n      showSlide(\"questionSlide\");\n      renderReviewQuestion();\n    }\n\n    function renderReviewQuestion() {\n      const q = activeQuiz[currentQuestionIndex];\n      const saved = userAnswers[currentQuestionIndex];\n      const questionSlide = document.getElementById(\"questionSlide\");\n      questionSlide.classList.add(\"is-reviewing\");\n      selectedAnswerIndex = saved ? saved.selectedAnswerIndex : null;\n      document.getElementById(\"counter\").textContent = `${currentQuestionIndex + 1}/${activeQuiz.length}`;\n      document.getElementById(\"questionText\").innerHTML = q.question;\n      document.getElementById(\"submitBtn\").classList.remove(\"is-visible\");\n      document.getElementById(\"questionImage\").style.display = \"none\";\n\n      const container = document.getElementById(\"answersContainer\");\n      container.innerHTML = \"\";\n      q.answers.forEach((answer) => {\n        const card = document.createElement(\"div\");\n        card.className = \"answer-card\";\n        card.innerHTML = `<div class=\"radio-circle\"></div><div>${answer.text}</div>`;\n        container.appendChild(card);\n      });\n\n      renderSubmittedState(q, saved ? saved.selectedAnswerIndex : null, saved ? saved.isCorrect : false, true, saved ? saved.fbImage : \"\");\n      addReviewNavigation();\n    }\n\n    function addReviewNavigation() {\n  removeReviewNavigation();\n\n  const nav = document.createElement(\"div\");\n  nav.id = \"reviewNav\";\n\n  nav.innerHTML = `\n  <button id=\"leftReviewArrow\" class=\"review-arrow left\" onclick=\"previousReviewQuestion()\">‹</button>\n  <button id=\"rightReviewArrow\" class=\"review-arrow right\" onclick=\"nextReviewQuestion()\">›</button>\n`;\n\n  const questionSlide = document.getElementById(\"questionSlide\");\n  questionSlide.appendChild(nav);\n}\n\nfunction positionReviewArrows() {\n  // Navigation is positioned in the 720 x 540 design coordinate system and\n  // scales together with the confirmed-working question slide.\n}\n\n\n\n    function previousReviewQuestion() {\n      if (currentQuestionIndex === 0) { showResults(); return; }\n      currentQuestionIndex--; renderReviewQuestion();\n    }\n\n    function nextReviewQuestion() {\n      if (currentQuestionIndex === activeQuiz.length - 1) { showResults(); return; }\n      currentQuestionIndex++; renderReviewQuestion();\n    }\n\n    window.addEventListener(\"resize\", positionReviewArrows);\n\nfunction removeReviewNavigation() {\n  const nav = document.getElementById(\"reviewNav\");\n  if (nav) nav.remove();\n}\n  </script>\n</body>\n</html>";

  return platformTemplate
    .replaceAll("__EDGE_QUIZ_TITLE_TEXT__", escapeHtml(plainTitle))
    .replaceAll("__EDGE_QUIZ_TITLE_ATTRIBUTE__", escapeHtml(rawTitle))
    .replaceAll("__EDGE_QUIZ_TITLE_HTML__", rawTitle)
    .replaceAll("__EDGE_QUIZ_FILENAME__", escapeHtml(safeFilename))
    .replaceAll("__EDGE_RANDOMIZE_EXPORT__", exportData.randomizeExport === false ? "false" : "true")
    .replaceAll("__EDGE_RANDOMIZE_ANSWERS_EXPORT__", exportData.randomizeAnswersExport === false ? "false" : "true")
    .replace("__EDGE_RANDOMIZE_QUESTIONS__", exportData.randomizeExport === false ? "false" : "true")
    .replace("__EDGE_RANDOMIZE_ANSWERS__", exportData.randomizeAnswersExport === false ? "false" : "true")
    .replace("__EDGE_QUIZ_DATA__", safeQuizData);
}

// ── Autosave and builder validation ───────────────────────
let autosaveTimer = null;
const AUTOSAVE_KEY = "edgeQuizBuilderV2";
function scheduleAutosave(){ clearTimeout(autosaveTimer); autosaveTimer=setTimeout(saveDraft,350); }
function saveDraft(){
  try{
    const data=buildQuizExportData();
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({...data, questionCount:Number(document.getElementById("questionCount").value)}));
  }catch(_){ }
}
function restoreDraft(){
  try{
    const raw=localStorage.getItem(AUTOSAVE_KEY); if(!raw) return;
    const data=JSON.parse(raw);
    document.getElementById("questionCount").value=String(data.questionCount||data.questions?.length||5);
    document.getElementById("quizFilename").value=data.filename||"";
    const randomizePreview=document.getElementById("randomizePreview");
    const randomizeAnswersPreview=document.getElementById("randomizeAnswersPreview");
    const randomizeExport=document.getElementById("randomizeExport");
    const randomizeAnswersExport=document.getElementById("randomizeAnswersExport");
    if(randomizePreview) randomizePreview.checked=data.randomizePreview!==false;
    if(randomizeAnswersPreview) randomizeAnswersPreview.checked=data.randomizeAnswersPreview!==false;
    if(randomizeExport) randomizeExport.checked=data.randomizeExport!==false;
    if(randomizeAnswersExport) randomizeAnswersExport.checked=data.randomizeAnswersExport!==false;
    generateQuestionFields(); setHtml("quizTitle",data.title||""); populateFields(data.questions||[]);
  }catch(_){ }
}
function validationSeverityRank(severity) {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

function fieldPageNumber(fieldId) {
  if (!fieldId || fieldId === "quizTitle" || fieldId === "quizFilename") return 0;
  const questionMatch = fieldId.match(/^question_(\d+)$/);
  if (questionMatch) return Number(questionMatch[1]);
  const itemMatch = fieldId.match(/^q(\d+)_/);
  return itemMatch ? Number(itemMatch[1]) : 0;
}

function smallestFontSize(editor) {
  if (!editor || !editor.textContent.trim()) return null;
  let minimum = Number.parseFloat(getComputedStyle(editor).fontSize);
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.textContent.trim()) continue;
    const parent = node.parentElement || editor;
    const size = Number.parseFloat(getComputedStyle(parent).fontSize);
    if (Number.isFinite(size)) minimum = Math.min(minimum, size);
  }
  return Number.isFinite(minimum) ? minimum : null;
}

function collectValidationIssues() {
  const issues = [];
  const count = Number(document.getElementById("questionCount").value);
  const add = (severity, message, fieldId = "") => issues.push({ severity, message, fieldId });

  if (!getText("quizTitle")) add("error", "Add a quiz title.", "quizTitle");

  const rawFilename = document.getElementById("quizFilename").value.trim();
  if (!rawFilename) {
    add("error", "Add an output name.", "quizFilename");
  } else if (rawFilename !== getFilename()) {
    add("warning", `Output name will be sanitised to “${getFilename()}”.`, "quizFilename");
  }

  for (let i = 1; i <= count; i++) {
    const questionId = `question_${i}`;
    if (!getText(questionId)) add("error", `Question ${i}: add question text.`, questionId);

    const answerTexts = [];
    for (let a = 1; a <= 4; a++) {
      const answerId = `q${i}_answer_${a}`;
      const answerText = getText(answerId);
      answerTexts.push(answerText.toLocaleLowerCase().replace(/\s+/g, " ").trim());
      if (!answerText) add("error", `Question ${i}: add Answer ${a}.`, answerId);
    }

    const seenAnswers = new Map();
    answerTexts.forEach((answer, index) => {
      if (!answer) return;
      if (seenAnswers.has(answer)) {
        add("warning", `Question ${i}: Answer ${seenAnswers.get(answer) + 1} and Answer ${index + 1} are duplicates.`, `q${i}_answer_${index + 1}`);
      } else {
        seenAnswers.set(answer, index);
      }
    });

    const correctValue = Number(document.getElementById(`q${i}_correct`)?.value);
    if (!Number.isInteger(correctValue) || correctValue < 0 || correctValue > 3) {
      add("error", `Question ${i}: choose a valid correct answer.`, questionId);
    }

    const feedbackId = `q${i}_feedback`;
    if (!getText(feedbackId)) add("warning", `Question ${i}: feedback is empty.`, feedbackId);
  }

  const editors = [...document.querySelectorAll(".editable")];
  editors.forEach(editor => {
    if (!editor.textContent.trim()) return;
    const overflow = measureEditorOverflow(editor);
    const label = editorLabel(editor.id);
    const spacing = getEditorLineSpacing(editor);
    const spacingLabel = spacing === "1" ? "Single" : spacing === "2" ? "Double" : spacing;

    if (overflow.vertical) {
      add(
        "warning",
        `${label}: content is about ${Math.ceil(overflow.overflowY)} px too tall (line spacing: ${spacingLabel}). A vertical scrollbar is shown in the builder.`,
        editor.id
      );
    }
    if (overflow.horizontal) {
      add(
        "warning",
        `${label}: content is about ${Math.ceil(overflow.overflowX)} px too wide. Check long equations, URLs or unbroken text.`,
        editor.id
      );
    }

    const visualProblems = measureEmbeddedVisualOverflow(editor);
    visualProblems.forEach(problem => {
      add(
        "warning",
        `${label}: embedded ${problem.tag.toUpperCase()} is about ${Math.ceil(problem.width)} × ${Math.ceil(problem.height)} px, but the learner text area is about ${Math.floor(problem.availableWidth)} × ${Math.floor(problem.availableHeight)} px. Resize it to match the source and fit the box.`,
        editor.id
      );
    });

    const minSize = smallestFontSize(editor);
    if (minSize !== null && minSize < 12) {
      add("warning", `${label}: text smaller than 12 px may be difficult to read.`, editor.id);
    }
  });

  issues.sort((a, b) => validationSeverityRank(a.severity) - validationSeverityRank(b.severity));
  return issues;
}

function ensureValidationDialog() {
  let dialog = document.getElementById("validationDialog");
  if (dialog) return dialog;

  dialog = document.createElement("div");
  dialog.id = "validationDialog";
  dialog.className = "validation-dialog";
  dialog.setAttribute("aria-hidden", "true");
  dialog.innerHTML = `
    <div class="validation-backdrop" onclick="closeValidationDialog()"></div>
    <section class="validation-card" role="dialog" aria-modal="true" aria-labelledby="validationHeading">
      <div class="validation-card-header">
        <div>
          <h2 id="validationHeading">Quiz validation</h2>
          <p id="validationSummary"></p>
        </div>
        <button type="button" class="validation-close" onclick="closeValidationDialog()" aria-label="Close validation">Close</button>
      </div>
      <div id="validationResults" class="validation-results"></div>
    </section>`;
  document.body.appendChild(dialog);
  return dialog;
}

function openValidationDialog(issues) {
  const dialog = ensureValidationDialog();
  const results = dialog.querySelector("#validationResults");
  const summary = dialog.querySelector("#validationSummary");
  const counts = issues.reduce((acc, issue) => {
    acc[issue.severity]++;
    return acc;
  }, { error: 0, warning: 0, info: 0 });

  summary.textContent = issues.length
    ? `${counts.error} error${counts.error === 1 ? "" : "s"} · ${counts.warning} warning${counts.warning === 1 ? "" : "s"}${counts.info ? ` · ${counts.info} info` : ""}`
    : "No validation issues found.";

  if (!issues.length) {
    results.innerHTML = `<div class="validation-empty"><strong>Validation passed.</strong><span>The quiz is ready for your normal preview/export checks.</span></div>`;
  } else {
    results.innerHTML = issues.map((issue, index) => `
      <button type="button" class="validation-result validation-${issue.severity}" onclick="jumpToValidationIssue(${index})">
        <span class="validation-severity">${issue.severity}</span>
        <span>${escapeValidationText(issue.message)}</span>
      </button>`).join("");
  }

  window.currentValidationIssues = issues;
  dialog.classList.add("is-open");
  dialog.setAttribute("aria-hidden", "false");
}

function escapeValidationText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function closeValidationDialog() {
  const dialog = document.getElementById("validationDialog");
  if (!dialog) return;
  dialog.classList.remove("is-open");
  dialog.setAttribute("aria-hidden", "true");
}

function jumpToValidationIssue(index) {
  const issue = window.currentValidationIssues?.[index];
  if (!issue || !issue.fieldId) return;
  closeValidationDialog();

  if (issue.fieldId === "quizFilename") {
    const input = document.getElementById("quizFilename");
    input?.focus();
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const page = fieldPageNumber(issue.fieldId);
  showQuestionPage(page);
  if (issue.fieldId.includes("_feedback")) {
    feedbackVisible = true;
    const panel = document.querySelector(`#questionPage_${page} .feedback-mock`);
    if (panel) panel.style.display = "block";
  }

  const editor = document.getElementById(issue.fieldId);
  if (!editor) return;
  setActiveEditor(issue.fieldId);
  editor.focus({ preventScroll: true });
  editor.scrollIntoView({ behavior: "smooth", block: "center" });
  editor.classList.add("validation-target");
  window.setTimeout(() => editor.classList.remove("validation-target"), 2200);
}

function validateQuiz(showSuccess=false){
  refreshAllOverflowStates();
  const issues = collectValidationIssues();
  if (issues.length || showSuccess) openValidationDialog(issues);
  return !issues.some(issue => issue.severity === "error");
}



// ── Builder viewport fit ──────────────────────────────────
// Keeps the 720 × 540 authoring canvas proportional, but scales it down when
// the available browser height is smaller. The export design size is unchanged.
let builderCanvasResizeFrame = null;

function installBuilderViewportFitStyles() {
  if (document.getElementById("builderViewportFitStyles")) return;

  const style = document.createElement("style");
  style.id = "builderViewportFitStyles";
  style.textContent = `
    :root {
      --builder-canvas-scale: 1;
      --builder-canvas-height: 540px;
    }

    .app-header {
      height: 74px;
      padding-top: 10px;
      padding-bottom: 10px;
    }

    .builder-layout {
      padding-top: 16px;
      padding-bottom: 10px;
    }

    .settings-panel {
      top: 90px;
    }

    .shared-toolbar {
      min-height: 44px;
      top: 86px;
    }

    .page-navigation {
      margin: 10px 0;
    }

    .canvas-area {
      padding: 14px;
      overflow: hidden;
    }

    .question-block.active {
      height: var(--builder-canvas-height);
      min-height: var(--builder-canvas-height);
      align-items: flex-start;
    }

    .quiz-canvas {
      transform: scale(var(--builder-canvas-scale));
      transform-origin: top center;
    }

    .page-controls {
      margin: 8px 0 0;
    }
  `;
  document.head.appendChild(style);
}

function resizeBuilderCanvas() {
  cancelAnimationFrame(builderCanvasResizeFrame);
  builderCanvasResizeFrame = requestAnimationFrame(() => {
    const canvasArea = document.querySelector(".canvas-area");
    const controls = document.querySelector(".page-controls");
    const layout = document.querySelector(".builder-layout");
    if (!canvasArea || !layout) return;

    const areaStyle = getComputedStyle(canvasArea);
    const layoutStyle = getComputedStyle(layout);
    const controlsStyle = controls ? getComputedStyle(controls) : null;

    const horizontalPadding =
      (parseFloat(areaStyle.paddingLeft) || 0) +
      (parseFloat(areaStyle.paddingRight) || 0);
    const verticalPadding =
      (parseFloat(areaStyle.paddingTop) || 0) +
      (parseFloat(areaStyle.paddingBottom) || 0);
    const controlsSpace = controls
      ? controls.offsetHeight +
        (parseFloat(controlsStyle.marginTop) || 0) +
        (parseFloat(controlsStyle.marginBottom) || 0)
      : 0;
    const layoutBottomPadding = parseFloat(layoutStyle.paddingBottom) || 0;

    const availableWidth = Math.max(320, canvasArea.clientWidth - horizontalPadding);
    const availableHeight = Math.max(
      260,
      window.innerHeight -
        canvasArea.getBoundingClientRect().top -
        controlsSpace -
        layoutBottomPadding -
        verticalPadding -
        4
    );

    const scale = Math.max(
      0.55,
      Math.min(1, availableWidth / 720, availableHeight / 540)
    );

    document.documentElement.style.setProperty(
      "--builder-canvas-scale",
      scale.toFixed(4)
    );
    document.documentElement.style.setProperty(
      "--builder-canvas-height",
      `${(540 * scale).toFixed(2)}px`
    );
    refreshAllOverflowStates();
  });
}

window.addEventListener("DOMContentLoaded", () => {
  installBuilderViewportFitStyles();
  updateAiPromptModeUi();
  const toolbar = document.getElementById("sharedToolbar");
  toolbar.classList.add("inactive");
  toolbar.addEventListener("mousedown", event => {
    const button = event.target.closest("button");
    if (!button) return;
    saveActiveSelection();
    event.preventDefault();
  });
  toolbar.querySelectorAll("select").forEach(select => {
    select.addEventListener("pointerdown", saveActiveSelection);
  });
  const sharedHtmlEditor = document.getElementById("sharedHtmlEditor");
  if (sharedHtmlEditor) sharedHtmlEditor.addEventListener("input", handleSharedHtmlInput);
  document.addEventListener("selectionchange", () => {
    if (!activeEditorId) return;
    const editor = document.getElementById(activeEditorId);
    const selection = window.getSelection();
    if (!editor || !selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    savedSelection = range.cloneRange();
    updateToolbarState();
  });
  generateQuestionFields();
  const randomizePreview=document.getElementById("randomizePreview");
  const randomizeAnswersPreview=document.getElementById("randomizeAnswersPreview");
  const randomizeExport=document.getElementById("randomizeExport");
  const randomizeAnswersExport=document.getElementById("randomizeAnswersExport");
  if(randomizePreview) randomizePreview.checked=true;
  if(randomizeAnswersPreview) randomizeAnswersPreview.checked=true;
  if(randomizeExport) randomizeExport.checked=true;
  if(randomizeAnswersExport) randomizeAnswersExport.checked=true;
  ["quizFilename","questionCount","randomizePreview","randomizeAnswersPreview","randomizeExport","randomizeAnswersExport"].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener("change",scheduleAutosave); });
  restoreDraft();
  resizeBuilderCanvas();
  window.addEventListener("resize", resizeBuilderCanvas);
  if (typeof ResizeObserver === "function") {
    const workspace = document.querySelector(".workspace");
    if (workspace) new ResizeObserver(resizeBuilderCanvas).observe(workspace);
  }
});
