# Changelog

## [0.7.0](https://github.com/rivet-gg/actor-core/compare/v0.6.3...v0.7.0) (2025-03-16)


### ⚠ BREAKING CHANGES

* rename onInitialize -> onCreate ([#714](https://github.com/rivet-gg/actor-core/issues/714))
* rename rpcs -> actions ([#711](https://github.com/rivet-gg/actor-core/issues/711))
* expose functional interface for actors ([#710](https://github.com/rivet-gg/actor-core/issues/710))

### Features

* **cli:** add `--skip-manager` flag on deploy ([#708](https://github.com/rivet-gg/actor-core/issues/708)) ([f46776d](https://github.com/rivet-gg/actor-core/commit/f46776d21f4c669d8f1d134743889d3591f12a5d))
* expose functional interface for actors ([#710](https://github.com/rivet-gg/actor-core/issues/710)) ([803133d](https://github.com/rivet-gg/actor-core/commit/803133d9f7404db5479bf92635eafc1c9f99acef))


### Bug Fixes

* fix schedule logging schedule errors ([#709](https://github.com/rivet-gg/actor-core/issues/709)) ([f336561](https://github.com/rivet-gg/actor-core/commit/f336561e7427eb87ed4ee930d405cc571a2cd775))


### Documentation

* update docs for new changes ([#713](https://github.com/rivet-gg/actor-core/issues/713)) ([fa990dd](https://github.com/rivet-gg/actor-core/commit/fa990dd22fdfc7cefea8f140cbcd2fcf05025dea))


### Chores

* add ws & eventsource as dev dependencies of actor-core so it can build ([1cdf9c4](https://github.com/rivet-gg/actor-core/commit/1cdf9c4351367a152224697029b047e5ef66518a))
* fix typo of "Actor Core" -&gt; "ActorCore" ([#707](https://github.com/rivet-gg/actor-core/issues/707)) ([d1e8be5](https://github.com/rivet-gg/actor-core/commit/d1e8be523fc75e1c55ad529bd85bc832a545b12a))
* increase RPC timeout from 5s to 60s ([#705](https://github.com/rivet-gg/actor-core/issues/705)) ([ec6a478](https://github.com/rivet-gg/actor-core/commit/ec6a478e9ffff91028e8f2f718c79e65d3479354))
* release 0.7.0 ([0a9b745](https://github.com/rivet-gg/actor-core/commit/0a9b745f966379ed324be2a354d91999cb65e1f1))
* release version 0.7.0 ([0fbc3da](https://github.com/rivet-gg/actor-core/commit/0fbc3da0430581cc47543d2904c8241fa38d4f0e))
* rename onInitialize -&gt; onCreate ([#714](https://github.com/rivet-gg/actor-core/issues/714)) ([3b9b106](https://github.com/rivet-gg/actor-core/commit/3b9b1069d55352545291e4ea593b05cd0b8f89f5))
* rename rpcs -&gt; actions ([#711](https://github.com/rivet-gg/actor-core/issues/711)) ([8957e56](https://github.com/rivet-gg/actor-core/commit/8957e560572e7594db03d9ea631bf32995a61bd0))
* show full subpath to value that cannot be serialized when setting invalid state ([#706](https://github.com/rivet-gg/actor-core/issues/706)) ([a666bc3](https://github.com/rivet-gg/actor-core/commit/a666bc37644966d7482f54370ab92c5b259136b9))
* update changelog for 0.7.0 ([#715](https://github.com/rivet-gg/actor-core/issues/715)) ([dba8085](https://github.com/rivet-gg/actor-core/commit/dba808513f2fb42ebd84f0d1dd21b3798223fda1))
* update platforms to support `ActorCoreApp` ([#712](https://github.com/rivet-gg/actor-core/issues/712)) ([576a101](https://github.com/rivet-gg/actor-core/commit/576a101dcfcbe5c44ff771db1db64b275a68cf81))

## [0.6.3](https://github.com/rivet-gg/actor-core/compare/v0.6.2...v0.6.3) (2025-03-13)


### Features

* add client dispose method to clean up actor handles ([#686](https://github.com/rivet-gg/actor-core/issues/686)) ([ff1e64d](https://github.com/rivet-gg/actor-core/commit/ff1e64d952798f86cc4d67505a7fa2904749217b))


### Bug Fixes

* **client:** fix fallback priority of websockets & eventsources ([#700](https://github.com/rivet-gg/actor-core/issues/700)) ([86550a0](https://github.com/rivet-gg/actor-core/commit/86550a0ca5838ab4cd0c5f3d4229f3031d037d10))
* **client:** modify endpoint to start with `ws` and `wss` ([#690](https://github.com/rivet-gg/actor-core/issues/690)) ([8aed4ce](https://github.com/rivet-gg/actor-core/commit/8aed4ceba6724d85c091a7660e5addcd7308c5cd))
* **cli:** escape combined command, allow npx to install pkg ([#695](https://github.com/rivet-gg/actor-core/issues/695)) ([0f173e6](https://github.com/rivet-gg/actor-core/commit/0f173e68c074236fd59437574b9c5f499db8d55d))
* **cli:** force to use npx when calling @rivet-gg/cli ([#698](https://github.com/rivet-gg/actor-core/issues/698)) ([7d3d1d9](https://github.com/rivet-gg/actor-core/commit/7d3d1d99127d0373d29c33dedd16d3aeadf9e318))
* correct "onwer" typo to "owner" in deploy command ([#694](https://github.com/rivet-gg/actor-core/issues/694)) ([cbc1255](https://github.com/rivet-gg/actor-core/commit/cbc1255ae73ce9be07bfc80e97dd61f868579769))
* implement schedule event saving functionality ([#687](https://github.com/rivet-gg/actor-core/issues/687)) ([59f78f3](https://github.com/rivet-gg/actor-core/commit/59f78f39a6cfd5d050d5359bbc224a6d7a2a3ea8))
* remove use of .disconnect in example ([382ddb8](https://github.com/rivet-gg/actor-core/commit/382ddb84cb14f6d22edf55281da4b4c030bfeb44))
* skip CORS for WebSocket routes ([#703](https://github.com/rivet-gg/actor-core/issues/703)) ([d51d618](https://github.com/rivet-gg/actor-core/commit/d51d618c7f40daeead28716194534ab944293fbd))
* use app.notFound instead of app.all("*") for 404 handling ([#701](https://github.com/rivet-gg/actor-core/issues/701)) ([727dd28](https://github.com/rivet-gg/actor-core/commit/727dd280c84e0d09928f62d4b99531d58900f865))


### Chores

* add explicit error handling for all hono routes ([#702](https://github.com/rivet-gg/actor-core/issues/702)) ([365de24](https://github.com/rivet-gg/actor-core/commit/365de24b75061eee931f473414c221286c6e0684))
* changelog for 0.6.3 ([cf6d723](https://github.com/rivet-gg/actor-core/commit/cf6d723a081029e8241a643186d41a09701192bd))
* fix grammar on index ([#689](https://github.com/rivet-gg/actor-core/issues/689)) ([dac5660](https://github.com/rivet-gg/actor-core/commit/dac566058490c28ad34511dcee77c962602c6a3e))
* **memory:** explicitly pass global state to memory driver ([#688](https://github.com/rivet-gg/actor-core/issues/688)) ([542bd1c](https://github.com/rivet-gg/actor-core/commit/542bd1c22b5d8844410bd9d3ae970162a6b481f2))
* release 0.6.3 ([e06db47](https://github.com/rivet-gg/actor-core/commit/e06db47aba656e47a721376e767dece5b0cd2934))

## [0.6.2](https://github.com/rivet-gg/actor-core/compare/v0.6.1...v0.6.2) (2025-03-13)


### Features

* add inpector ([#676](https://github.com/rivet-gg/actor-core/issues/676)) ([a38c3af](https://github.com/rivet-gg/actor-core/commit/a38c3af13aace93ddd0d3e488de10737ae9741b3))
* add skip-install flag to create command ([#673](https://github.com/rivet-gg/actor-core/issues/673)) ([71dbd10](https://github.com/rivet-gg/actor-core/commit/71dbd105fe16f3453e3d837920cea8217277bd1d))
* **cli:** tests ([#671](https://github.com/rivet-gg/actor-core/issues/671)) ([44d1f7b](https://github.com/rivet-gg/actor-core/commit/44d1f7ba378d8c44c9e95987d5986af0d6e55b4a))


### Bug Fixes

* **cli:** adjust deploy command to use proper lib ([#681](https://github.com/rivet-gg/actor-core/issues/681)) ([037ed55](https://github.com/rivet-gg/actor-core/commit/037ed55a3939863f12d9acae4c3c04b5c3ec0720))
* **cli:** improve examples, and create-actor help, reduce information overload when deploying ([#670](https://github.com/rivet-gg/actor-core/issues/670)) ([2f19149](https://github.com/rivet-gg/actor-core/commit/2f19149218f3a645d647bc6d97755313222886b0))


### Chores

* bump required rivet cli version to 25.2.0 ([#679](https://github.com/rivet-gg/actor-core/issues/679)) ([e31e921](https://github.com/rivet-gg/actor-core/commit/e31e92144f04a9f10e04af813ebb32c8a368744b))
* **main:** release 0.7.0 ([#678](https://github.com/rivet-gg/actor-core/issues/678)) ([6a61617](https://github.com/rivet-gg/actor-core/commit/6a616178cd4b9ed5d465e3cd44a8791023ee0fe2))
* release 0.6.2 ([4361f9e](https://github.com/rivet-gg/actor-core/commit/4361f9ea3bbd1da97f51b39772f4d9cc410cb86c))
* release version 0.6.2 ([677bda2](https://github.com/rivet-gg/actor-core/commit/677bda2f934ca2a26a1579aeefa871145ecaaecb))
* update lockfile ([7b61057](https://github.com/rivet-gg/actor-core/commit/7b6105796a2bbec69d75dbd0cae717b2e8fd7827))

## [0.6.1](https://github.com/rivet-gg/actor-core/compare/v0.6.0...v0.6.1) (2025-03-05)


### Chores

* **publish:** add build step to publish script ([3c43e26](https://github.com/rivet-gg/actor-core/commit/3c43e26279e74cef941b2c98853c850951ccf2de))
* **publish:** add build step to publish script ([#667](https://github.com/rivet-gg/actor-core/issues/667)) ([3c43e26](https://github.com/rivet-gg/actor-core/commit/3c43e26279e74cef941b2c98853c850951ccf2de))
* release 0.6.1 ([5e817f6](https://github.com/rivet-gg/actor-core/commit/5e817f63a5397c8dba1cfb5e45ed814150f77233))
* release 0.6.1 ([3c43e26](https://github.com/rivet-gg/actor-core/commit/3c43e26279e74cef941b2c98853c850951ccf2de))
* release 0.6.1-rc.1 ([3c43e26](https://github.com/rivet-gg/actor-core/commit/3c43e26279e74cef941b2c98853c850951ccf2de))
* release version 0.6.1 ([3c43e26](https://github.com/rivet-gg/actor-core/commit/3c43e26279e74cef941b2c98853c850951ccf2de))
* release version 0.6.1-rc.1 ([3c43e26](https://github.com/rivet-gg/actor-core/commit/3c43e26279e74cef941b2c98853c850951ccf2de))

## [0.6.0](https://github.com/rivet-gg/actor-core/compare/v0.4.0...v0.6.0) (2025-03-05)


### Features

* **@actor-core/cli:** add cli ([#642](https://github.com/rivet-gg/actor-core/issues/642)) ([d919f1a](https://github.com/rivet-gg/actor-core/commit/d919f1aa11972f0513f6ad5851965b7f469624cd))
* add config validation ([#648](https://github.com/rivet-gg/actor-core/issues/648)) ([3323988](https://github.com/rivet-gg/actor-core/commit/3323988f6ab3d5d9ba99ba113f6b8e4a7f4c5ec7))
* add cors support ([#647](https://github.com/rivet-gg/actor-core/issues/647)) ([ef13939](https://github.com/rivet-gg/actor-core/commit/ef13939f57c333d19b1cafc29b003bce1ccb8cf9))
* add release candidate support to publish script ([#660](https://github.com/rivet-gg/actor-core/issues/660)) ([f6c6adc](https://github.com/rivet-gg/actor-core/commit/f6c6adc8dd8fe9ceb237ba55be7f5953fe8047ec))
* **create-actor:** add create-actor lib ([#641](https://github.com/rivet-gg/actor-core/issues/641)) ([05b5894](https://github.com/rivet-gg/actor-core/commit/05b5894d4ca84f3b76f4a6fb6fa2ff4c6a5f9372))
* support transport negotiation between client and server ([#636](https://github.com/rivet-gg/actor-core/issues/636)) ([a6fa986](https://github.com/rivet-gg/actor-core/commit/a6fa986b657e7fa294c95fb95cc51cc7930651be))


### Bug Fixes

* exclude create-actor from non-core packages validation ([#656](https://github.com/rivet-gg/actor-core/issues/656)) ([2f2e1da](https://github.com/rivet-gg/actor-core/commit/2f2e1daa4fdb5643b389c6fb261c96a0f37471fa))
* update yarn.lock deps ([#655](https://github.com/rivet-gg/actor-core/issues/655)) ([39958ab](https://github.com/rivet-gg/actor-core/commit/39958abb0387e3b6a83bc13613665d2ec44b129b))


### Documentation

* add changelog ([#651](https://github.com/rivet-gg/actor-core/issues/651)) ([4931a2a](https://github.com/rivet-gg/actor-core/commit/4931a2a2e7eb244791f48508ee94d50dc1ea401e))
* add changelog for v0.6.0 ([#661](https://github.com/rivet-gg/actor-core/issues/661)) ([22fa68c](https://github.com/rivet-gg/actor-core/commit/22fa68c092614fbb61228fcd96a84af9292d648c))
* add llm resources ([#653](https://github.com/rivet-gg/actor-core/issues/653)) ([de201a4](https://github.com/rivet-gg/actor-core/commit/de201a4b4796fc43fc4cb330e1e1e5bec1b4d239))
* fix private method name in schedule example ([#643](https://github.com/rivet-gg/actor-core/issues/643)) ([8ada3a7](https://github.com/rivet-gg/actor-core/commit/8ada3a7e13f564ae0135861951703778d72a39c4))
* new landing page ([#630](https://github.com/rivet-gg/actor-core/issues/630)) ([b8e4a8b](https://github.com/rivet-gg/actor-core/commit/b8e4a8b1c7a5311372faa00aeeb5a883c762032b))
* replace managing actors with building actors & interacting with actors ([436d76c](https://github.com/rivet-gg/actor-core/commit/436d76c2de133bc1337d9e2240e274a2060540d6))
* replace managing actors with building actors & interacting with actors ([#654](https://github.com/rivet-gg/actor-core/issues/654)) ([436d76c](https://github.com/rivet-gg/actor-core/commit/436d76c2de133bc1337d9e2240e274a2060540d6))
* update Bluesky profile URL ([#644](https://github.com/rivet-gg/actor-core/issues/644)) ([5e4d5ee](https://github.com/rivet-gg/actor-core/commit/5e4d5eec962ab0e243fc99561b5179c351f222dd))
* update changelog for add your own driver ([#652](https://github.com/rivet-gg/actor-core/issues/652)) ([dc17dd1](https://github.com/rivet-gg/actor-core/commit/dc17dd1702a72680a8830841cb10005840ecd036))
* update feature comparison table ([#640](https://github.com/rivet-gg/actor-core/issues/640)) ([237784e](https://github.com/rivet-gg/actor-core/commit/237784ed69c67a3578c4e51f989ad8816092cefa))
* update quickstart guide ([436d76c](https://github.com/rivet-gg/actor-core/commit/436d76c2de133bc1337d9e2240e274a2060540d6))
* update Rivet documentation links ([#664](https://github.com/rivet-gg/actor-core/issues/664)) ([1ab1947](https://github.com/rivet-gg/actor-core/commit/1ab194738a4448f10afab55a2b37c8326e6d66ee))


### Code Refactoring

* move redis p2p logic to generic driver ([#645](https://github.com/rivet-gg/actor-core/issues/645)) ([35c5f71](https://github.com/rivet-gg/actor-core/commit/35c5f71d4a2b17f699c348c8a1cd80589cf40af7))


### Chores

* add aider to gitignore ([#635](https://github.com/rivet-gg/actor-core/issues/635)) ([b8cedf2](https://github.com/rivet-gg/actor-core/commit/b8cedf2c6cec502abdda37f4c4d142a62fbfbc02))
* add commit logging to publish script ([#657](https://github.com/rivet-gg/actor-core/issues/657)) ([6d9b73b](https://github.com/rivet-gg/actor-core/commit/6d9b73be7c4dd475a02c79eead584bda85348bf5))
* add docs-bump command ([0d9ebb8](https://github.com/rivet-gg/actor-core/commit/0d9ebb8f64a32005e12db808149f63832f197cfd))
* bump mintlify ([6e88f31](https://github.com/rivet-gg/actor-core/commit/6e88f312bb6535b271ce7aeb3e9dafc8ad7a9c3a))
* bump mintlify ([64b99e4](https://github.com/rivet-gg/actor-core/commit/64b99e4178ae2a61a62c0d0874524bcb78b296d0))
* bump mintlify ([42a1d83](https://github.com/rivet-gg/actor-core/commit/42a1d83ec26019f31ab0a0258553f9a3c8833cb5))
* bump mintlify ([e6f0263](https://github.com/rivet-gg/actor-core/commit/e6f026379e51b95e4164e4f818718e0128defa18))
* **cloudflare-workers:** export ActorHandle with createRouter ([#649](https://github.com/rivet-gg/actor-core/issues/649)) ([8c226be](https://github.com/rivet-gg/actor-core/commit/8c226be3a95909ab2d65b0c4b21a1fb9b4050e2d))
* docs-bump command ([1d93be1](https://github.com/rivet-gg/actor-core/commit/1d93be161db0b55dc7559cd4c57d602b17ff0dc0))
* **publish:** improve git push error handling ([6209d07](https://github.com/rivet-gg/actor-core/commit/6209d0745560588863789679ffa7eb2c506c1bfd))
* **publish:** improve git push error handling ([#659](https://github.com/rivet-gg/actor-core/issues/659)) ([6209d07](https://github.com/rivet-gg/actor-core/commit/6209d0745560588863789679ffa7eb2c506c1bfd))
* release 0.5.0 ([6e3aa0b](https://github.com/rivet-gg/actor-core/commit/6e3aa0bb9f2d9c1329cc019a7e4d7dbd565f33e6))
* release 0.6.0 ([df72a82](https://github.com/rivet-gg/actor-core/commit/df72a82d9186002770abd67fa192392be506b1ab))
* release 0.6.0-rc.1 ([6209d07](https://github.com/rivet-gg/actor-core/commit/6209d0745560588863789679ffa7eb2c506c1bfd))
* release 0.6.0-rc.1 ([9f015f8](https://github.com/rivet-gg/actor-core/commit/9f015f8b4c2b558408fe4f3e317a1efa765c82b6))
* release 0.6.0-rc.1 ([6794336](https://github.com/rivet-gg/actor-core/commit/6794336a3bab3aaefe19179b06a65cc31ecfeeef))
* release version 0.5.0 ([cec9ae1](https://github.com/rivet-gg/actor-core/commit/cec9ae1eae345d1828d7a2a56f525477c7aff2ca))
* release version 0.5.0 ([2f9766f](https://github.com/rivet-gg/actor-core/commit/2f9766fa598647d23e210828e91a39732810ceb7))
* release version 0.6.0 ([bb97593](https://github.com/rivet-gg/actor-core/commit/bb97593d95878a09b37f51b14bc5dbe14e91d117))
* release version 0.6.0-rc.1 ([8a92416](https://github.com/rivet-gg/actor-core/commit/8a92416e0006c6fe39bb57d5b275d8d67fc85299))
* **release:** check for changes before version commit ([9f015f8](https://github.com/rivet-gg/actor-core/commit/9f015f8b4c2b558408fe4f3e317a1efa765c82b6))
* **release:** check for changes before version commit ([#658](https://github.com/rivet-gg/actor-core/issues/658)) ([9f015f8](https://github.com/rivet-gg/actor-core/commit/9f015f8b4c2b558408fe4f3e317a1efa765c82b6))
* **release:** check if package already published before publishing ([#650](https://github.com/rivet-gg/actor-core/issues/650)) ([9cddff4](https://github.com/rivet-gg/actor-core/commit/9cddff4c4a157ad02208fbef58123c6677c16b3b))
* switch docs middleware to production URL ([#632](https://github.com/rivet-gg/actor-core/issues/632)) ([4698d60](https://github.com/rivet-gg/actor-core/commit/4698d604311501b4d784175fb2759dff84a72f83))
* update platform guides for create-actor ([#662](https://github.com/rivet-gg/actor-core/issues/662)) ([09626c0](https://github.com/rivet-gg/actor-core/commit/09626c01df4c017bef0896ba02cb338a268a0357))
* update readme for new quickstart ([#663](https://github.com/rivet-gg/actor-core/issues/663)) ([572a6ef](https://github.com/rivet-gg/actor-core/commit/572a6eff8d90e63b4647b21fb00c2e0ed25deb7b))
* update rivet links ([#634](https://github.com/rivet-gg/actor-core/issues/634)) ([f5a19b3](https://github.com/rivet-gg/actor-core/commit/f5a19b3c190387967e3f18c99c54edfbddf685fb))

## [0.4.0](https://github.com/rivet-gg/actor-core/compare/v0.2.0...v0.4.0) (2025-02-13)


### Features

* add connection retry with backoff ([#625](https://github.com/rivet-gg/actor-core/issues/625)) ([a0a59a6](https://github.com/rivet-gg/actor-core/commit/a0a59a6387e56f010d7f4df4c3385a76880c6222))
* **bun:** bun support ([#623](https://github.com/rivet-gg/actor-core/issues/623)) ([003a8a7](https://github.com/rivet-gg/actor-core/commit/003a8a761638e036d6edc431f5c7374923828964))
* **nodejs:** add nodejs support ([003a8a7](https://github.com/rivet-gg/actor-core/commit/003a8a761638e036d6edc431f5c7374923828964))


### Bug Fixes

* keep NodeJS process alive with interval ([#624](https://github.com/rivet-gg/actor-core/issues/624)) ([9aa2ace](https://github.com/rivet-gg/actor-core/commit/9aa2ace064c8f9b0581e7f469c10d7d915d651a3))


### Chores

* add bun and nodejs packages to publish script ([#628](https://github.com/rivet-gg/actor-core/issues/628)) ([b0367e6](https://github.com/rivet-gg/actor-core/commit/b0367e66d3d5fb1894b85262eac8c2e0f678e2b4))
* release 0.3.0-rc.1 ([16e25e8](https://github.com/rivet-gg/actor-core/commit/16e25e8158489da127d269f354be651ccbad4ce5))
* release 0.4.0 ([4ca17cd](https://github.com/rivet-gg/actor-core/commit/4ca17cd39fdc2c07bfce56a4326454e16ecadd40))
* release 0.4.0-rc.1 ([82ae37e](https://github.com/rivet-gg/actor-core/commit/82ae37e38e08dba806536811d7bea7678e6380db))
* release version 0.3.0-rc.1 ([5343b64](https://github.com/rivet-gg/actor-core/commit/5343b648466b11fc048a20d1379e38538a442add))
* release version 0.4.0 ([1f21931](https://github.com/rivet-gg/actor-core/commit/1f2193113398f9a51aadcea84e4807ab7d2ed194))
* release version 0.4.0-rc.1 ([9d6bf68](https://github.com/rivet-gg/actor-core/commit/9d6bf68df08045c6e720b3132eb46c5324d0aa92))
* update chat demo with topic ([#626](https://github.com/rivet-gg/actor-core/issues/626)) ([7be4cfb](https://github.com/rivet-gg/actor-core/commit/7be4cfb216f182c43d1e4b8500616d6a661f8006))

## [0.2.0](https://github.com/rivet-gg/actor-core/compare/v24.6.2...v0.2.0) (2025-02-06)


### Features

* sse conncetion driver ([#617](https://github.com/rivet-gg/actor-core/issues/617)) ([8a2b0a3](https://github.com/rivet-gg/actor-core/commit/8a2b0a3a0b07a0b4551c67fe7238da691d590892))


### Bug Fixes

* **cloudflare-workers:** accept requests proxied to actor without upgrade header ([#616](https://github.com/rivet-gg/actor-core/issues/616)) ([71246d3](https://github.com/rivet-gg/actor-core/commit/71246d38810a5ede89fc53458ccf1dae8357399b))


### Code Refactoring

* pass raw req to queryActor ([#613](https://github.com/rivet-gg/actor-core/issues/613)) ([e919123](https://github.com/rivet-gg/actor-core/commit/e919123b6d91497e68ea3b55f9ef10b10aff6f52))


### Continuous Integration

* add release please ([#614](https://github.com/rivet-gg/actor-core/issues/614)) ([c95bcea](https://github.com/rivet-gg/actor-core/commit/c95bceace69df54cf66bb4a339931dccb304c73e))


### Chores

* release 0.2.0 ([ed90143](https://github.com/rivet-gg/actor-core/commit/ed901437203f87aa5345f91bc9a3c5f8517bbfcb))
* release version 0.0.2 ([887af89](https://github.com/rivet-gg/actor-core/commit/887af89414e5fb8cb283efbb6a6948756cf75bab))
* release version 0.0.2 ([64b0cb4](https://github.com/rivet-gg/actor-core/commit/64b0cb4830f66ac864e458fe0ab2d95a88271c8e))
* release version 0.0.2 ([405b520](https://github.com/rivet-gg/actor-core/commit/405b5201730f9faa8c21457b09fc2a62101e34e8))
* release version 0.0.2 ([9e2d438](https://github.com/rivet-gg/actor-core/commit/9e2d438f4b7533925151556f6290a4a50eee2ad6))
* release version 0.0.3 ([951740e](https://github.com/rivet-gg/actor-core/commit/951740e76efe44745168ef1443e7c42931a39e11))
* release version 0.0.4 ([fbd865c](https://github.com/rivet-gg/actor-core/commit/fbd865ccca93a17e24780974f4e4bac2456ae13d))
* release version 0.0.5 ([1b4e780](https://github.com/rivet-gg/actor-core/commit/1b4e780d95092a93d879e45062e5c690199fb6f8))
* release version 0.0.6 ([375a709](https://github.com/rivet-gg/actor-core/commit/375a70965756e432b975a6cff0f49d07430023f2))
* release version 0.1.0 ([b797be8](https://github.com/rivet-gg/actor-core/commit/b797be80da2dbff153645585ac3063bbb4651eba))
* rename `ProtocolFormat` -&gt; `Encoding` ([#618](https://github.com/rivet-gg/actor-core/issues/618)) ([69ed424](https://github.com/rivet-gg/actor-core/commit/69ed42467ccd85a807cc1cd52f6a81584d0a430f))
* update images ([5070663](https://github.com/rivet-gg/actor-core/commit/5070663b2dc5baaa375f9b777295e82ad458188f))
* update release commit format ([#615](https://github.com/rivet-gg/actor-core/issues/615)) ([f7bf62d](https://github.com/rivet-gg/actor-core/commit/f7bf62d37a647383b33e2fb5191d1759a98a1101))
* updated logos and hero ([3e8c99e](https://github.com/rivet-gg/actor-core/commit/3e8c99ee207b7a9006f418d04561920b66faeef1))
