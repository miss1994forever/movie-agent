# Configuration Guide

This directory contains configuration templates and setup guides.

## Environment Setup

1. Copy `.env.example` to the project root as `.env`:
   ```bash
   cp config/.env.example .env
   ```

2. Edit `.env` with your API keys and credentials:
   - `GEMINI_API_KEY`: Your Google Gemini API key
   - `LETTERBOXD_USERNAME`: Your Letterboxd username
   - `LETTERBOXD_PASSWORD`: Your Letterboxd password  
   - `TMDB_API_KEY`: Your TMDB (TheMovieDB) API key

## Production Considerations

- Never commit `.env` files to version control
- Use environment-specific configs for different deployments
- Consider using secret management services for production

## Files in this directory

- `env.example`: Template environment configuration file