// Current workshop/gallery mobile paths. Historical suite: legacy_mobile.mjs.
import {runAudit} from './audit_browser.mjs';
await runAudit({mobile:true,engine:process.env.MIO_MOBILE_BROWSER||process.argv[2]||'chromium'});
