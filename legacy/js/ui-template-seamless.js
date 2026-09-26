/* An image-only built-in. No page decoration, caption slots or custom runtime. */
'use strict';

function seamlessTemplate(){return fileLayout('export-seamless')}

function seamlessHTML(){return seamlessTemplate().html}

function installSeamlessTemplate(){/* Resources are loaded from data/, never reinserted by normalization. */}
