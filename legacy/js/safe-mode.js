/* Runs before app / theme / third-party code. Shift+reload survives navigation. */
(()=>{
  let next=false;try{next=sessionStorage.getItem('mio-safe-next')==='1';sessionStorage.removeItem('mio-safe-next')}catch{}
  window.MioSafeMode=new URLSearchParams(location.search).get('safe_mode')==='1'||next;
  let shift=false;addEventListener('keydown',e=>{shift=e.shiftKey;if(e.shiftKey&&['F5','r','R'].includes(e.key)){try{sessionStorage.setItem('mio-safe-next','1')}catch{}}});
  addEventListener('keyup',e=>shift=e.shiftKey);
  addEventListener('beforeunload',()=>{if(shift)try{sessionStorage.setItem('mio-safe-next','1')}catch{}});
  if(window.MioSafeMode)document.documentElement.dataset.theme='light';
})();
