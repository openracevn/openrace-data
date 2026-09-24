# Administrative reference data

These files are generated from fixed source versions and are used offline to resolve a race point to current and legacy Vietnamese administrative codes.

## Sources

- [thanglequoc/vietnamese-provinces-database](https://github.com/thanglequoc/vietnamese-provinces-database), MIT licence, commit `8b78ba5118715e1fa81769286724db79346abf52` (2026-09-22). The geometry is dated 2026-03-11. Its internal numbers and properties are not official codes and are not used here.
- [tranngocminhhieu/vietnamadminunits](https://github.com/tranngocminhhieu/vietnamadminunits), MIT licence, commit `7fac8c45805aad9916b17237c54baf4502303b93` (2025-10-08).

## Files

- `units-2025.json`: the 34 current provinces and 3,321 current wards, with official codes, names and centres.
- `units-legacy.json`: the 63 legacy provinces, districts and wards, with legacy centres and each ward's mapped current ward.
- `wards-2025.json.gz`: current ward bounding boxes and simplified MultiPolygon boundaries, coordinates ordered as `[lng, lat]`.

## Rebuild

```sh
npm run geo:ref
```

The command downloads the three pinned source files to the ignored `ref/.cache/` cache when they are absent, unzips the boundary archive with `unzip`, and rewrites the committed files above.
