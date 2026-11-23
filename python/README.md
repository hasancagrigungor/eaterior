# eateryplan (Python)

Reference validator, migrator and importer for [Eatery Plan](../README.md).

```bash
pip install -e python
eateryplan validate examples/plan.json
```

Install without cloning:

```bash
pip install "git+https://github.com/hasancagrigungor/eatery-plan#subdirectory=python"
```

The schemas ship inside the package (`eateryplan/schemas/`, kept identical to `schemas/v1.1.0/` by a test).
Set `EATERYPLAN_SCHEMA_DIR` to use another copy.
