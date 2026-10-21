const fs=require('fs');
const path=require('path');
const {chromium}=require('/Users/lukeheary/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sharp=require('/Users/lukeheary/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const frames=JSON.parse(fs.readFileSync(path.join(__dirname,'frames.json'),'utf8'));
 const browser=await chromium.launch({headless:true,executablePath:"/Users/lukeheary/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell"});
 const page=await browser.newPage({viewport:{width:1320,height:2868},deviceScaleFactor:1});
 await page.goto('file://'+path.join(__dirname,'design.html'));
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
 for(const [,name] of frames){
  const section=page.locator('[id="'+name+'"]');
  const box=await section.locator('h1').boundingBox();
  if(box.x+box.width>1240)throw Error('Headline overflows '+name);
  await section.screenshot({path:path.join(root,'1320x2868',name+'.png')});
  await sharp(path.join(root,'1320x2868',name+'.png')).resize(1206,2622).removeAlpha().png().toFile(path.join(root,'1206x2622',name+'.png'));
  console.log(name+' rendered');
 }
 await browser.close();
 const composites=await Promise.all(frames.map(async([,name],i)=>({input:await sharp(path.join(root,'1320x2868',name+'.png')).resize(440,956).toBuffer(),left:(i%3)*440,top:Math.floor(i/3)*956})));
 await sharp({create:{width:1320,height:1912,channels:3,background:'#080d17'}}).composite(composites).png().toFile(path.join(root,'contact-sheet.png'));
 console.log('Contact sheet complete');
})();
