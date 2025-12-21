.PHONY: doctor help

help:
	@echo "Available commands:"
	@echo "  make doctor    - Run health check for all services"

doctor:
	@python scripts/doctor.py

