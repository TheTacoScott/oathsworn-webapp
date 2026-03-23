.PHONY: setup release help

help:
	@echo "Targets:"
	@echo "  setup                   Download APK, decompile, generate web data"
	@echo "  setup APK_CACHE=<path>  Same but cache the APK at a custom path"
	@echo "  release VERSION=vX.Y.Z  Tag and push a release"

setup:
	APK_CACHE=$(APK_CACHE) ./setup.sh

release:
ifndef VERSION
	$(error VERSION is required, e.g. make release VERSION=v0.1.0)
endif
	@git diff --quiet || (echo "Error: uncommitted changes - commit or stash first"; exit 1)
	@git diff --cached --quiet || (echo "Error: staged changes - commit or stash first"; exit 1)
	git tag -a $(VERSION) -m "Release $(VERSION)"
	git push origin $(VERSION)
	@echo ""
	@echo "Tag $(VERSION) pushed. Open to publish the release:"
	@echo "  https://github.com/TheTacoScott/oathsworn-webapp/releases/new?tag=$(VERSION)"
