# Future level — lighting and colour readability adjustment

The final area was excessively pink/white because the Future HDR bloom was wider and stronger than the other eras, while the procedural city lights, sky, core light, final holographic panel and puzzle node sprites were also very bright.

Changes (Future only):

- Toned down the Future colour grade and raised its bloom threshold; kept bloom enabled on Medium/High quality.
- Darkened the violet sky/nebula slightly, reduced the light-emission of distant buildings, traffic and lamps, and gave the immediate play corridor more space.
- Rebalanced deck trims and underlighting, the Neon Core and its point light.
- Replaced additive blending on the *final* colour-lock instruction panel with normal blending for an actual dark background.
- Made the colour-changing orbs and their billboards less blinding; the active node is still outlined.
- No changes to keyboard controls, puzzle logic, save/checkpoint state, level order, or the Past/Present rendering grades.

QA: Check the spire and colour-lock puzzle in Chrome at Medium and High quality. Cyan, magenta and gold should appear distinct; the colour panel and platform edges must be legible. Check Past and Present still look identical to the previous version. Test all levels from start to finish on the published LAMP URL after deploying.
