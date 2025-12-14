# Contributing to Brain Web

Thank you for your interest in contributing to Brain Web! This document provides guidelines and instructions for contributing.

## 🤝 How to Contribute

### Reporting Bugs

If you find a bug, please open an issue using the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:
- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, browser, versions)

### Suggesting Features

Have an idea for a new feature? Open an issue using the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md). Include:
- Clear description of the feature
- Problem it solves
- Proposed solution
- Use cases

### Code Contributions

1. **Fork the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/brain-web.git
   cd brain-web
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Set up development environment**
   - Backend: Follow [Quick Start Guide](docs/QUICKSTART.md)
   - Frontend: `cd frontend && npm install`

4. **Make your changes**
   - Follow existing code style
   - Write clear, self-documenting code
   - Add comments for complex logic

5. **Write tests**
   - Add tests for new features
   - Ensure all tests pass: `pytest` (backend)
   - Test manually in browser (frontend)

6. **Update documentation**
   - Update README if needed
   - Add/update code comments
   - Update API docs if adding endpoints

7. **Commit your changes**
   ```bash
   git commit -m "Add: Description of your feature"
   ```
   Use clear, descriptive commit messages.

8. **Push and create Pull Request**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then open a Pull Request using the [PR template](.github/pull_request_template.md).

## 📋 Development Guidelines

### Code Style

- **Python**: Follow PEP 8, use type hints
- **TypeScript/React**: Follow ESLint rules, use TypeScript types
- **Commit Messages**: Use clear, descriptive messages
  - Format: `Type: Description`
  - Types: `Add`, `Fix`, `Update`, `Refactor`, `Docs`

### Testing

- Write tests for new features
- Ensure existing tests still pass
- Test edge cases and error handling
- Manual testing in browser for UI changes

### Documentation

- Update README for major changes
- Add docstrings to new functions/classes
- Update API documentation for new endpoints
- Keep code comments up to date

## 🏗️ Project Structure

```
brain-web/
├── backend/          # FastAPI backend
│   ├── api_*.py      # API routers
│   ├── services_*.py # Business logic
│   ├── models.py     # Pydantic schemas
│   └── tests/        # Test suite
├── frontend/         # Next.js frontend
│   └── app/          # Next.js app directory
├── infra/            # Infrastructure as code
└── docs/             # Documentation
```

## 🧪 Running Tests

### Backend Tests
```bash
cd backend
source .venv/bin/activate
pytest
```

### Frontend Tests
Currently manual testing. Automated tests coming soon.

## 📝 Pull Request Process

1. Ensure your code follows style guidelines
2. Update documentation as needed
3. Add tests for new features
4. Ensure all tests pass
5. Update CHANGELOG if applicable
6. Request review from maintainers

## ❓ Questions?

Feel free to open an issue with questions or reach out to the maintainers.

Thank you for contributing to Brain Web! 🎉
