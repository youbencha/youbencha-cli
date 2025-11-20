# Task: Add Installation Instructions to README

## Objective

Add clear, complete installation instructions to the README.md file.

## Requirements

Your task is to update the README.md file to include installation instructions for this Node.js CLI tool. The instructions should help users understand:

1. **What they need** - Prerequisites (Node.js version requirement)
2. **How to install it** - The npm install command
3. **How to get started** - A quick start command to run the tool

## Specific Instructions

1. Add an "Installation" section to the README.md
2. Include the Node.js version requirement (check package.json for the required version)
3. Include the npm install command (this is not a global package)
4. Include a quick start example showing how to run the CLI after installation
5. Use proper markdown formatting:
   - Use heading syntax (##, ###)
   - Use code blocks (```) for commands
   - Keep formatting consistent with existing README style

## What NOT to do

- Do NOT modify any other files (only README.md should change)
- Do NOT remove or modify existing README content
- Do NOT add excessive content (LICENSE, CONTRIBUTING, badges, etc.)
- Do NOT add installation instructions for other package managers unless requested

## Success Criteria

Your changes will be evaluated on:
- ✅ Installation section is present
- ✅ Node.js version requirement is mentioned
- ✅ npm install command is correct
- ✅ Quick start usage example is included
- ✅ Markdown formatting is correct and consistent
- ✅ No other files are modified
- ✅ Existing README content is preserved

## Context

This is a simple CLI tool that generates random project names. Users install it as a local development dependency and run it via npm scripts or npx.

## Expected Time

This task should take 2-5 minutes for an AI coding agent to complete.

## Hints

- Check the package.json file to understand the project structure
- Look at the "name" field in package.json for the package name
- Check the "engines" field for Node.js version requirements
- The "bin" field shows the CLI command name
- Keep it simple - users just need to know how to install and run it
