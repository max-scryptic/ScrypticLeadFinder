"use client";

import { useEffect } from "react";

import { hasEmDash, stripEmDashes } from "@/lib/em-dash";

// Text inside these never renders, so leave it alone. Scrubbing a script body
// would rewrite running code.
const IGNORED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

// Attributes whose value is shown to the user, either on screen or through a
// screen reader.
const TEXT_ATTRIBUTES = [
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "label",
  "placeholder",
  "title",
];

function scrubText(node: Text) {
  const parent = node.parentElement;
  if (parent && IGNORED_TAGS.has(parent.tagName)) return;
  if (!hasEmDash(node.data)) return;

  node.data = stripEmDashes(node.data);
}

function scrubAttributes(element: Element) {
  for (const name of TEXT_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value && hasEmDash(value)) {
      element.setAttribute(name, stripEmDashes(value));
    }
  }
}

function scrubTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    scrubText(root as Text);
    return;
  }

  if (!(root instanceof Element)) return;
  if (IGNORED_TAGS.has(root.tagName)) return;

  scrubAttributes(root);

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node instanceof Element && IGNORED_TAGS.has(node.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof Element) scrubAttributes(node);
    else scrubText(node as Text);
  }
}

/**
 * Keeps em dashes out of the rendered page for the lifetime of the document.
 *
 * Authored copy is caught at lint time, but text that arrives at runtime (API
 * responses, model output, third party widgets) is only visible in the DOM, so
 * it gets scrubbed here as it lands. Rewriting a node cannot re-trigger the
 * observer into a loop: the replacement contains no em dash, so the next pass
 * finds nothing to change.
 */
export function EmDashGuard() {
  useEffect(() => {
    scrubTree(document.body);
    if (document.title && hasEmDash(document.title)) {
      document.title = stripEmDashes(document.title);
    }

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") {
          scrubText(record.target as Text);
          continue;
        }

        if (record.type === "attributes" && record.target instanceof Element) {
          scrubAttributes(record.target);
          continue;
        }

        for (const node of record.addedNodes) scrubTree(node);
      }
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TEXT_ATTRIBUTES,
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
