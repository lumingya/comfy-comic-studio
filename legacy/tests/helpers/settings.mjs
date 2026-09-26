/* Match the real user path: reveal collapsed groups before editing a field. */
export async function settingsField(page,selector){
  const scope=await page.locator('#modal[open] #preset-library').count()?'#preset-library':'#main';
  while(await page.locator(scope+' .group-toggle[aria-expanded="false"]').count())await page.locator(scope+' .group-toggle[aria-expanded="false"]').first().click();
  return page.locator(selector);
}
