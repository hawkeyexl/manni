Output beat1.mp4
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
Type "cat docs/install.md"
Sleep 300ms
Enter
Sleep 5s
