(function(){
  // SIMULADOR: base de datos falsa en el navegador. Nada se guarda en tu panel real.
  var DB = window.__DB = window.__SEED || {};
  var listeners = [];
  var SV = {'.sv':'timestamp'};
  function parts(p){ return String(p||'').split('/').filter(Boolean); }
  function get(p){ var o=DB; var ps=parts(p); for (var i=0;i<ps.length;i++){ if(o==null||typeof o!=='object') return null; o=o[ps[i]]; } return o===undefined?null:o; }
  function resolveSV(v){ if (v && typeof v==='object'){ if (v['.sv']==='timestamp') return Date.now(); var r=Array.isArray(v)?[]:{}; Object.keys(v).forEach(function(k){ var x=resolveSV(v[k]); if(x!==null&&x!==undefined) r[k]=x;}); return r;} return v; }
  function setp(p,v){ var ps=parts(p); if(v&&typeof v==='object'&&v['.sv']&&typeof v['.sv']==='object'&&'increment' in v['.sv']) v=(get(p)||0)+v['.sv'].increment; v=resolveSV(v); if(!ps.length){ DB=window.__DB=v||{}; return;} var o=DB; for(var i=0;i<ps.length-1;i++){ if(o[ps[i]]==null||typeof o[ps[i]]!=='object') o[ps[i]]={}; o=o[ps[i]]; } if(v===null||v===undefined) delete o[ps[ps.length-1]]; else o[ps[ps.length-1]]=JSON.parse(JSON.stringify(v)); }
  function clone(v){ return v==null?null:JSON.parse(JSON.stringify(v)); }
  function Snap(key,val){ this.key=key; this._v=val; }
  Snap.prototype.val=function(){ return clone(this._v); };
  Snap.prototype.exists=function(){ return this._v!=null; };
  // Simulador: se agrupan los avisos (máximo uno cada 250 ms) para que no se trabe con muchos carros moviéndose
  var pendienteFire=null; function fire(){ if(pendienteFire) return; pendienteFire=setTimeout(function(){ pendienteFire=null; listeners.slice().forEach(function(l){ l.cb(new Snap(l.q.key, l.q._eval())); }); },250); }
  function Q(path, f){ this.path=path; this.f=f||{}; this.key=parts(path).pop()||null; }
  Q.prototype._eval=function(){
    if (this.path==='.info/serverTimeOffset') return 0;
    var v=clone(get(this.path)); var f=this.f; if(!f.by||v==null) { if(f.last&&v){ var ks=Object.keys(v).slice(-f.last); var r={}; ks.forEach(function(k){r[k]=v[k];}); return r;} return v; }
    var r={}; var ks=Object.keys(v).filter(function(k){ var x=v[k]&&v[k][f.by]; if('eq' in f && x!==f.eq) return false; if('sa' in f && !(x>=f.sa)) return false; if('ea' in f && !(x<=f.ea)) return false; return true; });
    ks.sort(function(a,b){ return (v[a][f.by]>v[b][f.by])?1:-1; }); if(f.last) ks=ks.slice(-f.last); ks.forEach(function(k){ r[k]=v[k]; }); return Object.keys(r).length?r:null; };
  Q.prototype._w=function(o){ var f=Object.assign({},this.f,o); return new Q(this.path,f); };
  Q.prototype.orderByChild=function(k){ return this._w({by:k}); };
  Q.prototype.equalTo=function(v){ return this._w({eq:v}); };
  Q.prototype.startAt=function(v){ return this._w({sa:v}); };
  Q.prototype.endAt=function(v){ return this._w({ea:v}); };
  Q.prototype.limitToLast=function(n){ return this._w({last:n}); };
  Q.prototype.on=function(ev,cb){ var l={q:this,cb:cb}; listeners.push(l); var self=this; setTimeout(function(){ cb(new Snap(self.key,self._eval())); },0); return cb; };
  Q.prototype.off=function(ev,cb){ listeners=listeners.filter(function(l){ return l.cb!==cb; }); };
  Q.prototype.once=function(){ var s=new Snap(this.key,this._eval()); return Promise.resolve(s); };
  Q.prototype.child=function(c){ return new Q(this.path+'/'+c); };
  Q.prototype.set=function(v){ setp(this.path,v); fire(); return Promise.resolve(); };
  Q.prototype.remove=function(){ setp(this.path,null); fire(); return Promise.resolve(); };
  var n=0; Q.prototype.push=function(v){ var k='k'+Date.now().toString(36)+(n++); var r=new Q(this.path+'/'+k); if(v!==undefined){ r.set(v); r.then=function(a,b){ return Promise.resolve().then(a,b); }; } return r; };
  Q.prototype.update=function(m){ var base=this.path; Object.keys(m).forEach(function(k){ setp((base?base+'/':'')+k, m[k]); }); fire(); return Promise.resolve(); };
  Q.prototype.transaction=function(fn){ var cur=clone(get(this.path)); var r=fn(cur); var self=this; if(r===undefined) return Promise.resolve({committed:false,snapshot:new Snap(self.key,cur)}); setp(this.path,r); fire(); return Promise.resolve({committed:true,snapshot:new Snap(self.key,get(self.path))}); };
  var user={uid:'admin1',email:'admin@autoamigo.ec',delete:function(){return Promise.resolve();}};
  var authCbs=[];
  function Auth(main){ this.currentUser=main?user:null; this.main=main; }
  Auth.prototype.onAuthStateChanged=function(cb){ authCbs.push(cb); var u=this.currentUser; setTimeout(function(){cb(u);},0); };
  Auth.prototype.signInWithEmailAndPassword=function(){ this.currentUser=user; return Promise.resolve({user:user}); };
  Auth.prototype.createUserWithEmailAndPassword=function(e){ var u={uid:'u'+Math.random().toString(36).slice(2,8),email:e,delete:function(){return Promise.resolve();}}; return Promise.resolve({user:u}); };
  Auth.prototype.signOut=function(){ if(this.main){ this.currentUser=null; authCbs.forEach(function(cb){cb(null);}); } return Promise.resolve(); };
  var mainAuth=new Auth(true);
  var db={ ref:function(p){ return new Q(p||''); } };
  window.firebase={ initializeApp:function(c,name){ return { auth:function(){ return name?new Auth(false):mainAuth; }, database:function(){return db;} }; },
    auth:function(){ return mainAuth; }, database:function(){ return db; } };
  window.firebase.database.ServerValue={TIMESTAMP:SV,increment:function(n){return {'.sv':{increment:n}};}};
})();
