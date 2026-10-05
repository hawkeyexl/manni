#!/usr/bin/env bash
# Run a command with the AI-agent environment removed, so the recorded shell is
# the shell a person has. Astro 7 reads these through `am-i-vibing` and, inside
# an agent, backgrounds `astro preview` and prints JSON instead of its normal
# output. The demo shows what a person sees, so the capture runs without them.
# Usage: bash media/capture-site/clean-env.sh <command...>
unset_args=()
for v in $(compgen -e); do
  case "$v" in
    CLAUDE*|ANTHROPIC*|AI_AGENT|AGENT|BAGGAGE) unset_args+=(-u "$v") ;;
  esac
done
exec env "${unset_args[@]}" "$@"
