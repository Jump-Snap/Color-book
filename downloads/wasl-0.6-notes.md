# Wasl Android 0.6 test build

Built from bd9244cc85db8da35b6038c3d77e053194064db9 in Actions run 39138152674. Assemble, lint and all four emulator instrumentation tests passed, including a 625-message history preview with page navigation. SHA256: 3E2E37D9038EB5A1299B8FAA59114D7E90196C0A41323E76EF3C67C74E7D35ED.

Full postal SMS scan (no 500-message cutoff), paged review and persisted remaining uploads. XML limit is explicitly 50 MB. No real phone inbox, camera, WhatsApp or push delivery was tested by CI. Android may restrict READ_SMS for sideloaded applications; XML import remains available. Debug signing can differ between builds: send queued data before uninstalling if Android refuses the update; server orders remain intact.
