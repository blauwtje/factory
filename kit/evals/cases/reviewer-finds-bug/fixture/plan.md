# Plan: paginate

paginate(items, page, size) returns the items on a 1-based page. The last page may hold fewer than size items. A page past the end returns an empty array.
Proof: node --test test/paginate.test.mjs
