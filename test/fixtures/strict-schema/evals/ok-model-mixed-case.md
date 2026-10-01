---
evals:
  - id: judge-install
    assertion: The install steps run in the order shown.
    model: Qwen3.5-4B-Instruct
  - id: judge-local
    assertion: The install steps name the chart.
    model: 'C:\models\Qwen3.5-4B-Q4_K_M.gguf'
---

Model ids keep the case their provider publishes, and a local model may be a
Windows path.
