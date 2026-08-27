# Screenshot ledger

Captured from real visible controls after the M22-P5-012 correction. Installed
Chrome 151 and actual Playwright WebKit 26.5 are identified separately; WebKit
is not physical Safari. These are implementation evidence, not user visual
approval.

| File | Bytes | SHA-256 | Evidence |
| --- | ---: | --- | --- |
| `chrome-desktop-light-calendar-actions-complete.png` | 78,075 | `da42765d8bf06545bb4af9795c9de94515ffcb861790dd7e08c9e293949c538d` | Calendar controls complete |
| `chrome-desktop-light-calendar-target-search.png` | 97,513 | `c61e222090f1224ee8291cb8a8c49e4335a5d85384c9c50803c06049cf76a951` | Omitted worker found by visible search |
| `chrome-desktop-light-calendar-unassigned.png` | 53,720 | `c69b41fff2e89ef397f06cc62063dad5ff8fbc10b26121e8ecb2aeb5c469fa1f` | Initial Calendar state |
| `chrome-desktop-light-command-center-overview.png` | 584,472 | `eca8e663556f2d21aba0b093bece50a05bc97fb267f4def061bb1c7926795cc0` | Command Center overview |
| `chrome-desktop-light-command-center-target-last-page.png` | 589,708 | `7e7a1b1088ac4f521875cb70e8fdcc76279b2b36278b43a86ee836e0d8cee590` | Omitted crew on final page |
| `chrome-mobile-dark-calendar-actions-complete.png` | 383,051 | `a0e1dcf01758fbc421f1978e89dd6f31c712054f7f548bfdaf9b754318fff116` | Mobile Calendar controls |
| `chrome-mobile-dark-calendar-target-search.png` | 365,861 | `937bb7b1b90a41d27151bf5ee244e39b11c4ce63b861b5ea9f9638fe42d47080` | Mobile visible search |
| `chrome-mobile-dark-calendar-unassigned.png` | 360,823 | `5285fdddf4d733d539c3e1d60492e486b7f138dddae51d9a8a1d4ae6cf4838bd` | Mobile initial state |
| `chrome-mobile-dark-command-center-overview.png` | 1,105,274 | `e22ff66d6940af6472348acf15d6d30b8a4aa2e24627a5d4c9ea3e6a51043b05` | Mobile overview/reflow |
| `chrome-mobile-dark-command-center-target-last-page.png` | 1,075,127 | `961000b4e0649d07d9b37214fe77306cb201297a0130e36bf8d3419205857056` | Mobile final target page |
| `webkit-desktop-dark-calendar-actions-complete.png` | 82,141 | `d966a849fb994ff8b41ff872b2307a41ec536f2247e65d85acc1e23698787b02` | Calendar controls complete |
| `webkit-desktop-dark-calendar-target-search.png` | 84,143 | `a152f8921febdd6e28f5d0718ef6ba506e6f9e99c573198839b2995f4972c302` | Omitted worker found by visible search |
| `webkit-desktop-dark-calendar-unassigned.png` | 49,934 | `387834fbb1813b64a1a7763e66feda70008030bae115dd8b384c92b810330f6e` | Initial Calendar state |
| `webkit-desktop-dark-command-center-overview.png` | 288,900 | `b5ea34abcfe04e855568c5e2c9cc8387e3cc88809f8346373500b772de657058` | Command Center overview |
| `webkit-desktop-dark-command-center-target-last-page.png` | 304,235 | `6389fdb9add879713e393cde8a37a8907036370475977bae227eebe8a02645dd` | Omitted crew on final page |
| `webkit-mobile-light-calendar-actions-complete.png` | 295,496 | `534cf7651d2113ecf11d4a45db7de6d6092f8f9f1d52c92e5895c935d4ac7aac` | Mobile Calendar controls |
| `webkit-mobile-light-calendar-target-search.png` | 252,429 | `047a80cc6a8f29c728a9fe5fd1f51c947ebb345a96cca67b7ccb29d0e25a35c8` | Mobile visible search |
| `webkit-mobile-light-calendar-unassigned.png` | 274,110 | `da4e3e1aa653efe2cc595b3269bd539a0e9f00a30e223c878fda64bc39b3faaa` | Mobile initial state |
| `webkit-mobile-light-command-center-overview.png` | 657,789 | `d913a15dc6c371272e22a1ab3aca958c3bf595492afa93cdc308d2d62fd3a544` | Mobile overview/reflow |
| `webkit-mobile-light-command-center-target-last-page.png` | 679,334 | `8e546606440e31ea883f1d0a06537a83c33deb0ce9702e8bc098793a94a91b7b` | Mobile final target page |

The visible target dialogs show exact 200-of-207 initial coverage, safe hostile
labels, bounded search/paging, and the final-page state. Mobile captures retain
390 px/400% reflow and operable controls. Visual approval remains separate and
unclaimed.
