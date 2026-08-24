# CI Workflow

ملف `github-actions-ci.yml` هو workflow جاهز لـ GitHub Actions:
typecheck + i18n parity + engine tests + RLS tests + فحص فخ `IN(...,NULL)` في SQL.

**التفعيل** (خطوة يدوية واحدة — توكن الرفع الحالي لا يملك صلاحية `workflows`):

```bash
mkdir -p .github/workflows
cp ci/github-actions-ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml && git commit -m "ci: enable workflow" && git push
```

أو انسخ محتوى الملف يدويًا إلى `.github/workflows/ci.yml` من واجهة GitHub.
