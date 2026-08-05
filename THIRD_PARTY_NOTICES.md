# Third-party notices

## Kaneo

`apps/api`, `apps/app`, `packages/{email,libs,mcp,permissions,typescript-config}` and
`i18n/` are derived from [Kaneo](https://github.com/usekaneo/kaneo), vendored at commit
`debad748a86f3d2065b0a156c7b36a7e65610683` (2026-07-26).

The code has been adapted: the `@kaneo/*` package namespace was renamed to
`@nuraview/*`, the `KANEO_*` environment variables to `NURAVIEW_*`, and product
branding changed to NuraView. The upstream copyright notice below is retained as the
MIT licence requires.

```
MIT License

Copyright (c) 2024 Andrej Acevski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Plane — NOT used

[Plane](https://github.com/makeplane/plane) is AGPL-3.0. **No Plane code, asset or
stylesheet is present in this repository, and none may be added.** Plane is referenced
only as a visual and functional specification, from screenshots and from a running
instance.

This is deliberate: AGPL-3.0 §13 would require offering the complete corresponding
source of this application to every user interacting with it over a network — which
includes any client sent a public share link. That would cover the scraper, the
enrichment pipeline and the lead data model. CI fails the build if Plane markers appear
in a diff.
