# Chess Portfolio

A comprehensive chess portfolio application designed to automatically synchronize with the Lichess API and visualize game data, rating progression, and analytical statistics.

## Project Overview

This repository contains the source code for a dark-themed, data-driven chess portfolio. It serves as an automated platform for tracking and presenting chess performance metrics without requiring manual data entry. 

## Core Capabilities

- Automated Data Synchronization: Utilizes GitHub Actions to routinely fetch and parse Lichess user data.
- Performance Metrics: Tracks and visualizes Elo rating progression across multiple time controls (Rapid, Blitz, Bullet, Classical).
- Interactive Game Analysis: Features a built-in PGN viewer for replaying recent games with move validation.
- Repertoire Analytics: Provides a statistical breakdown of opening performance, including win/draw/loss ratios.
- Statistical Aggregation: Calculates and displays aggregated statistics including total games, peak ratings, and overall accuracy.

## Technical Architecture

The application is structured as a static single-page application (SPA) with automated data pipelines.

- Frontend Structure: Semantic HTML5.
- Styling: Pure CSS utilizing a variable-driven design system. No external CSS frameworks are employed.
- Scripting & Interactivity: Vanilla JavaScript (ES6+).
- External Libraries: 
  - Chart.js (Data visualization)
  - chess.js (PGN parsing and move generation)
- Automation: Python scripts orchestrated via GitHub Actions for API data retrieval and JSON generation.

## Local Deployment

To run the application in a local development environment, a local web server is required to bypass CORS restrictions when fetching JSON data.

Using Python:
```bash
python -m http.server 8080
```
Navigate to `http://localhost:8080` in your web browser.

Using Node.js:
```bash
npx serve .
```

## Data Synchronization Configuration

The application is configured to automatically fetch the latest game data from Lichess every 5 minutes via GitHub Actions.

To configure this pipeline for your own repository:
1. Navigate to Repository Settings > Secrets and variables > Actions > Variables.
2. Create a new repository variable named `LICHESS_USERNAME`.
3. Set the value to your exact Lichess username.

The workflow is defined in `.github/workflows/sync.yml`. It executes a Python script (`scripts/fetch_data.py`) to process the API response and commits the updated `data/profile.json` and `data/games.json` files back to the repository.

## Repository Structure

- `/`: Contains the core entry point (`index.html`), stylesheet (`style.css`), and application logic (`app.js`).
- `/data`: Stores the auto-generated JSON files containing user statistics and game histories.
- `/scripts`: Houses the Python data fetching utilities.
- `/.github/workflows`: Contains the CI/CD pipeline definitions.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
