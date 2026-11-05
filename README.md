# Westminster Dash — GitHub upload files

This version keeps the Westminster Dash logo, starts loading automatically, adds a top-left Keyboard toggle, defaults to 1600 × 900, and targets 120 FPS using a display-synchronized scheduler.

## Upload to your repository

1. Extract Westminster_Dash_GitHub.zip on your computer.
2. Open https://github.com/risoekppoo-cyber/gddashyes and select the main branch.
3. Select Add file → Upload files.
4. Upload index.html, README.md and .nojekyll into the repository's top level. Upload the extracted files, not the ZIP or an enclosing folder. If your computer hides .nojekyll, uploading index.html is sufficient for this HTML-only page.
5. Enter a commit message, such as “Add Westminster Dash”, select Commit directly to the main branch, and select Commit changes. If GitHub requires a pull request, create and merge it.
6. Open Settings → Pages. Under Source, select Deploy from a branch. Set Branch to main and folder to / (root), then Save.
7. Wait for the Pages build to complete. Open the site URL displayed in Settings → Pages. For this account and repository, the expected address is https://risoekppoo-cyber.github.io/gddashyes/ . That address works after deployment succeeds.

GitHub's own instructions:
- Uploading: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Playing

Open the GitHub Pages site in your browser. The normal github.com repository page shows source files; it does not run the game. Do not launch index.html through Files preview on an iPad.

The game loads automatically. Tap Keyboard in the upper-left to show or hide the on-screen controls. Hold Space or Up to jump. Escape pauses/backs out, and the letter/number keys also work for in-game menus and text entry. Shift can be held with a letter on a multi-touch screen. Closing the panel, cancelling a touch or switching away releases held virtual keys.

The default internal resolution is 1600 × 900 instead of 1920 × 1080 (about 31% fewer rendered pixels). The game still scales to the browser window. For a slower device, append ?quality=low to use 1280 × 720. Append ?quality=high for 1920 × 1080.

120 FPS is a target/cap, not a performance guarantee. A 120 Hz or faster screen, browser support and sufficient CPU/GPU performance are needed to display 120 FPS. A 60 Hz screen normally runs this scheduler at about 60 FPS. Background tabs are throttled. This does not change the game's physics or playback speed.

Internet access is required: the page fetches the original game runtime, data and audio from upstream sources. The first download is large. It requires WebAssembly JSPI, WebGL2 and enough available memory. Unsupported Safari versions cannot be fixed by adding a keyboard; update the operating system/browser or use a compatible desktop browser. Sound may require the first tap on the game.

## Contents

- index.html: the customized launcher, title images, keyboard and frame scheduler, all embedded in one uploadable file.
- .nojekyll: optional static-site marker for GitHub Pages.
- README.md: these instructions.

The ZIP does not bundle the original game runtime/data and is not an offline installation.

## Validation

JavaScript syntax checked. The on-screen keyboard was tested against the port's actual input bridge for Space, arrows and letters, including key release. The frame scheduler was simulated at 60, 120, 144 and 240 Hz. Full gameplay and actual device FPS have not been verified in this environment.

## Credits

Original game: RobTop. Web port: bog / Ale7208.
Upstream web port: https://github.com/Ale7208/Geometry-Dash-webport
Custom Westminster Dash title and controls added for this project.
