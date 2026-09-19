'use strict';
module.exports = {
  "order": [
    "state",
    "sync",
    "workflow-mapping",
    "engine",
    "creation",
    "ui-presentation",
    "ui-reader",
    "ui-templates",
    "ui-export",
    "ui-editors",
    "ui-locale",
    "ui-assistant",
    "ui-storyboard",
    "ui-gallery",
    "ui-settings",
    "ui",
    "workspace",
    "organize",
    "foundation",
    "ui-image-studio",
    "ui-template-afterglow",
    "ui-template-seamless",
    "file-library",
    "contextual-sharing",
    "album-metadata",
    "workflow-workbench",
    "app"
  ],
  "architecture": "Classic scripts in dependency order; feature declarations precede shared UI state; app installs at the end."
};
