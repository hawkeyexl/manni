Output beat3.mp4
Set Shell "bash"
Set FontFamily "JetBrains Mono"
Set FontSize 28
Set Width 1200
Set Height 980
Set Padding 0
Set CursorBlink false
Set TypingSpeed 50ms
Set Framerate 30
Hide
Type `cd ../repo && export PATH="$(cd ../bin && pwd):$PATH" && PS1='$ ' && cp ../install.broken.md docs/install.md && clear`
Enter
Sleep 1500ms
Show
Sleep 500ms
Type "sed -i 's|docmeta|@hawkeyexl/manni|' docs/install.md"
Enter
Wait+Line@20s /^[$] ?$/
Sleep 400ms
Type "tail -1 docs/install.md"
Enter
Wait+Line@20s /^[$] ?$/
Sleep 1500ms
Type "manni docevals run --collection site --deterministic-only"
Sleep 400ms
Enter
Wait+Line@20s /^[$] ?$/
Sleep 2500ms
Type "echo $?"
Enter
Wait+Line@20s /^[$] ?$/
Sleep 3s
