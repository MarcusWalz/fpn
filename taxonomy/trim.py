#!/usr/bin/env python3
"""Trim the raw fpnotebook taxonomy into a leaner outline.

    python3 taxonomy/trim.py taxonomy/fpnotebook-2011.json taxonomy/outline.json

Rules:
  * drop the Jokes book
  * crossover chapters (named after another book, e.g. Neurology > "Pediatrics")
    are folded into the book's "General" chapter. Pharmacology, Radiology,
    Pathology/Lab and Prevention are kept as chapters: inside a specialty they
    work as categories rather than crossovers.
  * chapters with <= TINY topics are folded into "General" too
  * topic titles are de-duplicated within a chapter
"""
import json
import sys

DROP_BOOKS = {"jokes"}
KEEP_AS_CATEGORY = {"pharmacology", "radiology", "pathology and laboratory medicine", "prevention"}
TINY = 2
GENERAL = "General"


def main(src, dst):
    books = [b for b in json.load(open(src)) if b["title"].strip().lower() not in DROP_BOOKS]
    book_titles = {b["title"].strip().lower() for b in books} | DROP_BOOKS

    stats = {"crossover": 0, "tiny": 0}
    for b in books:
        kept, general_topics, general = [], [], None
        for ch in b.get("children", []):
            name = ch["title"].strip().lower()
            topics = ch.get("children", [])
            if name == GENERAL.lower():
                general = ch
                continue
            if name in book_titles and name not in KEEP_AS_CATEGORY and name != b["title"].strip().lower():
                stats["crossover"] += 1
                general_topics += topics
            elif len(topics) <= TINY:
                stats["tiny"] += 1
                general_topics += topics
            else:
                kept.append(ch)
        if general_topics or general:
            if general is None:
                general = {"title": GENERAL, "href": b["href"] + "General/", "children": []}
            general["children"] = general.get("children", []) + general_topics
            kept.append(general)
        for ch in kept:
            seen, uniq = set(), []
            for t in ch.get("children", []):
                k = t["title"].strip().lower()
                if k not in seen:
                    seen.add(k)
                    uniq.append(t)
            ch["children"] = sorted(uniq, key=lambda t: t["title"].lower())
        b["children"] = sorted(kept, key=lambda c: (c["title"] == GENERAL, c["title"].lower()))

    json.dump(books, open(dst, "w"), indent=1, ensure_ascii=False)
    chapters = sum(len(b["children"]) for b in books)
    topics = sum(len(c["children"]) for b in books for c in b["children"])
    print(f"{len(books)} books, {chapters} chapters, {topics} planned topics "
          f"(folded {stats['crossover']} crossover + {stats['tiny']} tiny chapters into {GENERAL})")


if __name__ == "__main__":
    main(*sys.argv[1:3])
