(function(){
  "use strict";
  var DATA = window.__DATA__;
  var DAYS = DATA.days;                 // 최신 날짜가 index 0
  var TODAY = DAYS.length ? DAYS[0].date : "";

  /* ---------- 학습 기록 저장소 (db 우선, localStorage 대체) ---------- */
  var LS_KEY = "jp-study-progress-v1";
  var state = { learned:{}, word:{}, quiz:[], visits:{} };
  var remote = null, saveTimer = null, remoteOK = false;

  function readLocal(){
    try { var raw = localStorage.getItem(LS_KEY); if(raw) return JSON.parse(raw); } catch(e){}
    return null;
  }
  function writeLocal(){
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e){}
  }
  function merge(src){
    if(!src || typeof src !== "object") return;
    ["learned","word","visits"].forEach(function(k){
      if(src[k] && typeof src[k] === "object") Object.keys(src[k]).forEach(function(id){ state[k][id] = src[k][id]; });
    });
    // 퀴즈 기록은 덮어쓰지 않고 at(푼 시각)으로 합친다 — 다른 기기에서 푼 기록이 사라지지 않도록
    if(Array.isArray(src.quiz) && src.quiz.length){
      var seen = {}, out = [];
      state.quiz.concat(src.quiz).forEach(function(q){
        if(!q) return;
        var key = q.at != null ? String(q.at) : JSON.stringify(q);
        if(seen[key]) return;
        seen[key] = 1; out.push(q);
      });
      out.sort(function(a,b){ return (a.at||0) - (b.at||0); });
      state.quiz = out.slice(-200);
    }
  }
  function pushRemote(){
    if(!remote) return;
    remote.set(JSON.parse(JSON.stringify(state))).catch(function(){});
  }
  function save(){
    writeLocal();
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(pushRemote, 600);
  }
  merge(readLocal());

  /* db는 페이지가 뜬 뒤에 준비된다(첫 실행 중에는 절대 오지 않음) — 항상 나중에 반영한다.
     onSnapshot이 넘겨주는 snap은 '봉투'이고 실제 내용은 snap.data()로 꺼내야 한다.
     (예전 코드가 봉투를 그대로 합치는 바람에 저장된 체크가 복원되지 않았다.) */
  if(window.claude && typeof window.claude.use === "function"){
    window.claude.use("db").then(function(db){
      if(!db) return;                      // 이 화면에선 db를 못 씀 — localStorage만으로 동작
      remote = db.doc("progress/state");
      remoteOK = true;
      var first = true;
      remote.onSnapshot(function(snap){
        var before = JSON.stringify(state);
        if(snap && snap.exists){
          var body = snap.data();
          if(body) merge(body);
        }
        var changed = JSON.stringify(state) !== before;
        if(changed) writeLocal();
        if(changed || first) renderAll();
        if(first){
          first = false;
          pushRemote();                    // 서버에 없던 로컬 기록까지 한 번 올려 맞춘다
        }
      }, function(){
        remoteOK = false;                  // 구독이 끊겨도 localStorage로 계속 동작
        renderAll();
      });
    }).catch(function(){});
  }

  /* ---------- helpers ---------- */
  var esc = function(s){ var d=document.createElement("div"); d.textContent = s==null?"":s; return d.innerHTML; };
  function sid(date, i){ return date + "#" + i; }
  function dayLearned(day){
    var n = 0;
    for(var i=0;i<day.sentences.length;i++){ if(state.learned[sid(day.date,i)]) n++; }
    return n;
  }
  function parseDate(s){ var p = s.split("-"); return new Date(+p[0], +p[1]-1, +p[2]); }
  function dayGap(a,b){ return Math.round((parseDate(a) - parseDate(b)) / 86400000); }
  function markVisit(){
    if(!TODAY) return;
    if(!state.visits[TODAY]){ state.visits[TODAY] = 1; save(); }
  }

  /* ---------- 일본어 발음 재생 (Web Speech API) ---------- */
  var jaVoice = null, toastTimer = null;
  function pickVoice(){
    try {
      var vs = window.speechSynthesis.getVoices() || [];
      jaVoice = vs.filter(function(v){ return /^ja/i.test(v.lang || ""); })[0] || null;
    } catch(e){}
  }
  if(window.speechSynthesis){
    pickVoice();
    try { window.speechSynthesis.onvoiceschanged = pickVoice; } catch(e){}
  }
  function toast(msg){
    var el = document.getElementById("toast");
    if(!el){ el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.style.display = "block";
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.style.display = "none"; }, 2600);
  }
  var warmed = false, keepAlive = null, lastBtn = null;
  function clearBtn(){
    if(lastBtn){ lastBtn.classList.remove("playing"); lastBtn = null; }
    if(keepAlive){ clearInterval(keepAlive); keepAlive = null; }
  }
  function warmUp(){
    // iOS/Safari는 사용자 조작 안에서 한 번 speak을 호출해야 이후 재생이 허용된다.
    if(warmed || !window.speechSynthesis) return;
    warmed = true;
    try {
      var u = new SpeechSynthesisUtterance(" ");
      u.volume = 0; u.lang = "ja-JP";
      window.speechSynthesis.speak(u);
    } catch(e){}
  }
  function doSpeak(text, btn){
    try {
      if(!jaVoice) pickVoice();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      u.rate = 0.85;
      if(jaVoice) u.voice = jaVoice;
      var started = false;
      u.onstart = function(){ started = true; };
      u.onend = clearBtn;
      u.onerror = function(){ clearBtn(); toast("발음을 재생하지 못했습니다. 다시 눌러보세요."); };
      if(btn){ clearBtn(); btn.classList.add("playing"); lastBtn = btn; }
      window.speechSynthesis.speak(u);
      // Chrome은 긴 문장을 15초쯤에서 끊는다 — 주기적으로 resume 해 살려둔다.
      keepAlive = setInterval(function(){
        if(!window.speechSynthesis.speaking){ clearBtn(); return; }
        try { window.speechSynthesis.pause(); window.speechSynthesis.resume(); } catch(e){}
      }, 5000);
      // 재생이 아예 시작되지 않으면 알려준다.
      setTimeout(function(){
        if(!started && !window.speechSynthesis.speaking){
          clearBtn();
          toast(jaVoice ? "발음이 시작되지 않았습니다. 한 번 더 눌러보세요."
                        : "기기에 일본어 음성이 없어 재생할 수 없습니다.");
        }
      }, 900);
    } catch(e){ clearBtn(); toast("발음을 재생하지 못했습니다."); }
  }
  function speak(text, btn){
    if(!text) return;
    if(!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined"){
      toast("이 브라우저에서는 발음 재생을 지원하지 않습니다."); return;
    }
    warmUp();
    var sp = window.speechSynthesis;
    if(sp.speaking || sp.pending){
      // cancel 직후 같은 틱에서 speak하면 재생이 통째로 무시되는 버그가 있어 한 틱 띄운다.
      clearBtn();
      try { sp.cancel(); } catch(e){}
      setTimeout(function(){ doSpeak(text, btn); }, 120);
    } else {
      doSpeak(text, btn);
    }
  }

  /* ---------- 오늘 탭 ---------- */
  var query = "";
  var openDays = {};      // 날짜 섹션 펼침
  var openMonths = {};    // 월간(달력) 묶음 펼침
  var openCards = {};     // 문장 카드 펼침
  var openWords = {};     // 문장 카드별로 지금 뜻을 보고 있는 단어
  if(TODAY) openDays[TODAY] = true;

  /* 월 키와 이름 */
  function monthKey(date){ return date.slice(0,7); }                        // "2026-09"
  function monthLabel(key){ var p = key.split("-"); return (+p[0]) + "년 " + (+p[1]) + "월"; }

  /* 가장 최근 달만 달력을 펼쳐 둔다 */
  (function(){
    if(DAYS.length) openMonths[monthKey(DAYS[0].date)] = true;
  })();

  /* ---------- 문장 속 단어 사전 (탭하면 뜻 보기) ----------
     1순위: 그날 시험 본 단어(log의 words) → 2순위: 아래 N5·N4 기본 단어 */
  var BASE_WORDS = [
    ["行く","いく","가다"],["来る","くる","오다"],["帰る","かえる","돌아가다, 귀가하다"],
    ["見る","みる","보다"],["見せる","みせる","보여주다"],["聞く","きく","듣다, 묻다"],
    ["話す","はなす","이야기하다"],["言う","いう","말하다"],["思う","おもう","생각하다"],
    ["知る","しる","알다"],["分かる","わかる","알다, 이해하다"],["食べる","たべる","먹다"],
    ["飲む","のむ","마시다"],["買う","かう","사다"],["使う","つかう","쓰다, 사용하다"],
    ["作る","つくる","만들다"],["書く","かく","쓰다"],["読む","よむ","읽다"],
    ["持つ","もつ","들다, 가지다"],["待つ","まつ","기다리다"],["会う","あう","만나다"],
    ["働く","はたらく","일하다"],["休む","やすむ","쉬다"],["寝る","ねる","자다"],
    ["起きる","おきる","일어나다"],["出る","でる","나가다, 나오다"],["出す","だす","내다, 제출하다"],
    ["出かける","でかける","외출하다"],["入る","はいる","들어가다"],["入れる","いれる","넣다"],
    ["乗る","のる","타다"],["降りる","おりる","내리다"],["降る","ふる","(비·눈이) 내리다"],
    ["着く","つく","도착하다"],["着る","きる","입다"],["歩く","あるく","걷다"],
    ["走る","はしる","달리다"],["座る","すわる","앉다"],["立つ","たつ","서다"],
    ["立てる","たてる","세우다"],["始める","はじめる","시작하다"],["終わる","おわる","끝나다"],
    ["続ける","つづける","계속하다"],["決める","きめる","정하다"],["選ぶ","えらぶ","고르다"],
    ["探す","さがす","찾다"],["見つける","みつける","발견하다"],["忘れる","わすれる","잊다"],
    ["教える","おしえる","가르치다"],["習う","ならう","배우다"],["試す","ためす","시험해 보다"],
    ["変える","かえる","바꾸다"],["変わる","かわる","바뀌다"],["送る","おくる","보내다"],
    ["届く","とどく","도착하다, 닿다"],["呼ぶ","よぶ","부르다"],["頼む","たのむ","부탁하다"],
    ["払う","はらう","지불하다"],["貸す","かす","빌려주다"],["借りる","かりる","빌리다"],
    ["返す","かえす","돌려주다"],["直す","なおす","고치다"],["手伝う","てつだう","돕다"],
    ["迎える","むかえる","맞이하다"],["過ごす","すごす","지내다"],["泊まる","とまる","묵다"],
    ["撮る","とる","(사진을) 찍다"],["描く","えがく","그리다"],["歌う","うたう","노래하다"],
    ["遊ぶ","あそぶ","놀다"],["笑う","わらう","웃다"],["迷う","まよう","헤매다, 망설이다"],
    ["違う","ちがう","다르다, 틀리다"],["空く","すく","비다, (배가) 고프다"],
    ["開ける","あける","열다"],["閉める","しめる","닫다"],["消す","けす","끄다, 지우다"],
    ["鳴る","なる","울리다"],["洗う","あらう","씻다"],["並ぶ","ならぶ","줄서다"],
    ["もらう","もらう","받다"],["あげる","あげる","주다"],["くれる","くれる","(나에게) 주다"],
    ["できる","できる","할 수 있다, 생기다"],["がんばる","がんばる","힘내다"],
    ["新しい","あたらしい","새롭다"],["古い","ふるい","낡다, 오래되다"],["大きい","おおきい","크다"],
    ["小さい","ちいさい","작다"],["高い","たかい","높다, 비싸다"],["安い","やすい","싸다"],
    ["長い","ながい","길다"],["短い","みじかい","짧다"],["早い","はやい","이르다"],
    ["速い","はやい","빠르다"],["遅い","おそい","늦다, 느리다"],["多い","おおい","많다"],
    ["少ない","すくない","적다"],["悪い","わるい","나쁘다"],["楽しい","たのしい","즐겁다"],
    ["面白い","おもしろい","재미있다"],["忙しい","いそがしい","바쁘다"],["難しい","むずかしい","어렵다"],
    ["優しい","やさしい","상냥하다"],["寒い","さむい","춥다"],["涼しい","すずしい","시원하다"],
    ["暖かい","あたたかい","따뜻하다"],["熱い","あつい","뜨겁다"],["冷たい","つめたい","차갑다"],
    ["おいしい","おいしい","맛있다"],["広い","ひろい","넓다"],["狭い","せまい","좁다"],
    ["近い","ちかい","가깝다"],["遠い","とおい","멀다"],["強い","つよい","강하다"],
    ["弱い","よわい","약하다"],["明るい","あかるい","밝다"],["暗い","くらい","어둡다"],
    ["静か","しずか","조용함"],["有名","ゆうめい","유명함"],["便利","べんり","편리함"],
    ["大切","たいせつ","소중함"],["大変","たいへん","힘듦, 큰일"],["好き","すき","좋아함"],
    ["嫌い","きらい","싫어함"],["上手","じょうず","잘함"],["下手","へた","서투름"],
    ["楽","らく","편함, 수월함"],
    ["今日","きょう","오늘"],["明日","あした","내일"],["昨日","きのう","어제"],["今","いま","지금"],
    ["朝","あさ","아침"],["昼","ひる","낮, 점심"],["夜","よる","밤"],["午前","ごぜん","오전"],
    ["午後","ごご","오후"],["毎日","まいにち","매일"],["週末","しゅうまつ","주말"],
    ["今週","こんしゅう","이번 주"],["来週","らいしゅう","다음 주"],["先週","せんしゅう","지난주"],
    ["今月","こんげつ","이번 달"],["来月","らいげつ","다음 달"],["今年","ことし","올해"],
    ["人","ひと","사람"],["私","わたし","나, 저"],["家","いえ","집"],["部屋","へや","방"],
    ["会社","かいしゃ","회사"],["学校","がっこう","학교"],["病院","びょういん","병원"],
    ["銀行","ぎんこう","은행"],["図書館","としょかん","도서관"],["電車","でんしゃ","전철"],
    ["バス","バス","버스"],["車","くるま","자동차"],["自転車","じてんしゃ","자전거"],
    ["飛行機","ひこうき","비행기"],["道","みち","길"],["町","まち","동네, 마을"],
    ["水","みず","물"],["お茶","おちゃ","차"],["コーヒー","コーヒー","커피"],["ご飯","ごはん","밥"],
    ["昼ごはん","ひるごはん","점심밥"],["肉","にく","고기"],["魚","さかな","생선"],
    ["果物","くだもの","과일"],["パン","パン","빵"],["物","もの","물건, 것"],
    ["話","はなし","이야기"],["声","こえ","목소리"],["音","おと","소리"],["色","いろ","색"],
    ["名前","なまえ","이름"],
    ["言葉","ことば","말, 단어"],["漢字","かんじ","한자"],["本","ほん","책"],
    ["新聞","しんぶん","신문"],["雑誌","ざっし","잡지"],["手紙","てがみ","편지"],
    ["電話","でんわ","전화"],["スマホ","スマホ","스마트폰"],["パソコン","パソコン","컴퓨터"],
    ["テレビ","テレビ","텔레비전"],["映画","えいが","영화"],["雨","あめ","비"],
    ["風","かぜ","바람"],["海","うみ","바다"],["山","やま","산"],["川","かわ","강"],
    ["花","はな","꽃"],["犬","いぬ","개"],["猫","ねこ","고양이"],["子供","こども","아이"],
    ["家族","かぞく","가족"],["先生","せんせい","선생님"],["学生","がくせい","학생"],
    ["勉強","べんきょう","공부"],["運動","うんどう","운동"],["掃除","そうじ","청소"],
    ["質問","しつもん","질문"],["説明","せつめい","설명"],["経験","けいけん","경험"],
    ["生活","せいかつ","생활"],["心配","しんぱい","걱정"],["散歩","さんぽ","산책"],
    ["もう","もう","이미, 벌써"],["まだ","まだ","아직"],["ずっと","ずっと","계속, 훨씬"],
    ["いつも","いつも","항상"],["時々","ときどき","가끔"],["すぐ","すぐ","곧, 바로"],
    ["また","また","또, 다시"],["まず","まず","우선, 먼저"],["先に","さきに","먼저"],
    ["全部","ぜんぶ","전부"],["少し","すこし","조금"],["ちょっと","ちょっと","조금"],
    ["たくさん","たくさん","많이"],["とても","とても","매우"],["あまり","あまり","별로, 그다지"],
    ["本当に","ほんとうに","정말로"],["特に","とくに","특히"],["必ず","かならず","반드시"],
    ["きっと","きっと","분명, 꼭"],["やっぱり","やっぱり","역시"],["すっかり","すっかり","완전히"],
    ["急に","きゅうに","갑자기"],["一緒に","いっしょに","함께"],["そろそろ","そろそろ","슬슬"],
    ["一番","いちばん","가장"],["近く","ちかく","근처"],["前","まえ","앞, 전"],
    ["外","そと","밖"],["上","うえ","위"],["下","した","아래"],["右","みぎ","오른쪽"],
    ["左","ひだり","왼쪽"]
  ];

  var WORDIDX = null, BASEMAP = null;
  function baseMap(){
    if(BASEMAP) return BASEMAP;
    BASEMAP = {};
    BASE_WORDS.forEach(function(r){ BASEMAP[r[0]] = {word:r[0], reading:r[1], meaning:r[2]}; });
    return BASEMAP;
  }
  // 동사(う단으로 끝남)·い형용사만 활용되므로 그런 단어에만 어간을 만든다.
  // 買い物·空港·お腹처럼 명사에서 어간을 뽑으면 엉뚱한 글자에 뜻이 붙는다.
  var INFLECTED = /[うくぐすずつぬぶむるい]$/;
  function addToIndex(byFirst, w){
    var forms = [{k:w.word, s:false}];                                     // 원형
    if(/する$/.test(w.word) && w.word.length > 2)
      forms.push({k:w.word.replace(/する$/,""), s:false});                 // 準備する → 準備
    if(w.word.length >= 2 && /[一-鿿]/.test(w.word) && INFLECTED.test(w.word))
      forms.push({k:w.word.slice(0,-1), s:true});                          // 売り切れる → 売り切れ(+て/た…)
    forms.forEach(function(f){
      if(!f.k) return;
      var c = f.k.charAt(0);
      if(!byFirst[c]) byFirst[c] = [];
      for(var i=0;i<byFirst[c].length;i++){ if(byFirst[c][i].k === f.k) return; }   // 먼저 넣은 쪽 우선
      byFirst[c].push({k:f.k, s:f.s, w:w});
    });
  }
  function wordIndex(){
    if(WORDIDX) return WORDIDX;
    var byFirst = {};
    DAYS.forEach(function(d){ (d.words||[]).forEach(function(w){ addToIndex(byFirst, w); }); });
    BASE_WORDS.forEach(function(r){ addToIndex(byFirst, {word:r[0], reading:r[1], meaning:r[2]}); });
    Object.keys(byFirst).forEach(function(c){
      // 긴 단어 먼저, 길이가 같으면 원형이 어간보다 먼저 (空 하늘 > 空く의 어간 空)
      byFirst[c].sort(function(a,b){
        return (b.k.length - a.k.length) || ((a.s?1:0) - (b.s?1:0));
      });
    });
    WORDIDX = byFirst;
    return WORDIDX;
  }
  function lookupWord(word){
    var found = null;
    DAYS.forEach(function(d){
      (d.words||[]).forEach(function(w){ if(!found && w.word === word) found = w; });
    });
    return found || baseMap()[word] || null;
  }
  function isKana(ch){ return /[ぁ-ゖ]/.test(ch); }
  function annotateJP(jp, active){
    var idx = wordIndex(), out = "", i = 0;
    while(i < jp.length){
      var bucket = idx[jp.charAt(i)], hit = null;
      if(bucket){
        for(var k=0;k<bucket.length;k++){
          var c = bucket[k];
          if(jp.substr(i, c.k.length) !== c.k) continue;
          // 어간으로 맞춘 경우엔 바로 뒤가 히라가나(활용 어미)일 때만 인정 — 出る의 '出'가 出勤에 걸리지 않게
          if(c.s && !isKana(jp.charAt(i + c.k.length))) continue;
          hit = c; break;
        }
      }
      if(hit){
        out += '<button class="tw'+(active && hit.w.word === active ? " on" : "")
             + '" data-tw="'+esc(hit.w.word)+'">'+esc(hit.k)+'</button>';
        i += hit.k.length;
      } else {
        out += esc(jp.charAt(i));
        i++;
      }
    }
    return out;
  }

  function cardHTML(day, s, i){
    var id = sid(day.date, i);
    var open = !!openCards[id];
    var done = !!state.learned[id];
    var picked = openWords[id] || "";
    var h = '<article class="card' + (open?" open":"") + '" data-id="'+id+'">';
    h += '<div class="card-top"><span class="tag jp">'+esc(s.g||"N4")+'</span>'
       + '<span class="no">'+String(i+1).padStart(2,"0")+'/'+day.sentences.length+(done?' ✓':'')+'</span></div>';
    h += '<p class="kr">'+esc(s.kr)+'</p>';
    if(open){
      h += '<div class="reveal"><p class="ja jp">'+annotateJP(s.jp, picked)+'</p>'
         + '<p class="yomi">'+esc(s.yomi)+'</p>';
      var pw = picked ? lookupWord(picked) : null;
      if(pw){
        h += '<div class="wtip"><span class="l"><b class="jp">'+esc(pw.word)
           + '<i>'+esc(pw.reading)+'</i></b><span>'+esc(pw.meaning)+'</span></span>'
           + '<button class="wplay" data-speak="'+esc(pw.reading||pw.word)+'" aria-label="'
           + esc(pw.word)+' 발음 듣기">♪</button></div>';
      } else {
        h += '<p class="hint">밑줄 친 단어를 탭하면 뜻이 나와요.</p>';
      }
      h += '</div>';
      h += '<div class="actions">'
         + '<button class="btn ghost" data-act="toggle">뜻만 다시 보기</button>'
         + '<button class="btn ghost sq" data-act="speak" aria-label="일본어 발음 듣기">♪</button>'
         + '<button class="btn ghost sq'+(done?" on":"")+'" data-act="done" aria-label="학습 완료">✓</button>'
         + '</div>';
    } else {
      h += '<div class="actions"><button class="btn" data-act="toggle">일본어 보기</button>'
         + '<button class="btn ghost sq'+(done?" on":"")+'" data-act="done" aria-label="학습 완료">✓</button></div>';
    }
    return h + '</article>';
  }

  function daySectionHTML(day){
    var open = !!openDays[day.date];
    var learned = dayLearned(day);
    var badge = day.date === TODAY ? "오늘" : learned + "/" + day.sentences.length;
    var h = '<div class="stack">';
    h += '<button class="dayhead" data-day="'+day.date+'"><span class="t">'
       + '<b>'+esc(day.date)+' ('+esc(day.weekday)+')</b>'
       + '<span>'+esc(day.topic)+' · 문장 '+day.sentences.length+' · 단어 '+(day.words||[]).length+'</span>'
       + '</span><span class="pill">'+esc(badge)+'</span></button>';
    if(open){
      h += day.sentences.map(function(s,i){ return cardHTML(day, s, i); }).join("");
    }
    return h + '</div>';
  }

  function foldRowHTML(day){
    return '<button class="foldrow" data-day="'+day.date+'">'
      + '<span>'+esc(day.date)+' ('+esc(day.weekday)+') · '+esc(day.topic)+'</span><small>+</small></button>';
  }

  /* ---------- 월 묶음 + 달력 ---------- */
  function groupBy(list, keyFn){
    var order = [], map = {};
    list.forEach(function(d){
      var k = keyFn(d);
      if(!map[k]){ map[k] = []; order.push(k); }
      map[k].push(d);
    });
    return order.map(function(k){ return {key:k, list:map[k]}; });
  }
  function countUp(list){
    return {
      days: list.length,
      sentences: list.reduce(function(a,d){ return a + d.sentences.length; }, 0),
      words: list.reduce(function(a,d){ return a + (d.words||[]).length; }, 0)
    };
  }
  /* 그 달의 달력 격자 — 학습한 날짜만 눌러서 공부할 수 있고,
     점 색으로 그날 체크한 문장 수를 바로 보여준다 */
  function calendarGridHTML(monthK, monthDays){
    var dayMap = {};
    monthDays.forEach(function(d){ dayMap[d.date] = d; });
    var p = monthK.split("-"), y = +p[0], mo = +p[1];
    var firstDow = new Date(y, mo-1, 1).getDay();      // 0=일 ... 6=토
    var lastDate = new Date(y, mo, 0).getDate();
    var DOW = ["일","월","화","수","목","금","토"];
    var h = '<div class="cal-wrap"><div class="cal-dow">'
          + DOW.map(function(w){ return '<span>'+w+'</span>'; }).join("") + '</div>';
    h += '<div class="cal-grid">';
    // 빈 칸을 채우는 대신 1일을 grid-column으로 바로 그 요일 자리에 꽂는다
    // (invisible filler cell은 박스 모델이 어긋나 줄 높이가 들쭉날쭉해지는 문제가 있었다)
    for(var day=1; day<=lastDate; day++){
      var ds = y+"-"+String(mo).padStart(2,"0")+"-"+String(day).padStart(2,"0");
      var d = dayMap[ds];
      var isToday = ds === TODAY;
      var colStyle = day === 1 ? ' style="grid-column-start:'+(firstDow+1)+'"' : "";
      if(!d){
        h += '<span class="cal-cell nodata'+(isToday?" today":"")+'"'+colStyle+'>'+day+'</span>';
        continue;
      }
      var learned = dayLearned(d), total = d.sentences.length;
      var status = learned === 0 ? "none" : (learned >= total ? "full" : "part");
      var open = !!openDays[d.date];
      h += '<button class="cal-cell has-data '+status+(isToday?" today":"")+(open?" sel":"")
         + '" data-day="'+d.date+'"'+colStyle+' aria-label="'+esc(d.date)+' · '+esc(d.topic)+' · '+learned+'/'+total+'"><b>'
         + day + '</b><i></i></button>';
    }
    h += '</div>';
    h += '<div class="cal-legend"><span><i class="full"></i>다 외웠어요</span>'
       + '<span><i class="part"></i>일부만</span><span><i class="none"></i>아직</span></div>';
    h += '</div>';
    return h;
  }
  function monthTreeHTML(list){
    var h = "";
    groupBy(list, function(d){ return monthKey(d.date); }).forEach(function(m){
      var c = countUp(m.list), mopen = !!openMonths[m.key];
      h += '<button class="mrow" data-month="'+esc(m.key)+'"><span>'+esc(monthLabel(m.key))
         + '<span class="sub">'+c.days+'일 · 문장 '+c.sentences+' · 단어 '+c.words+'</span></span>'
         + '<small>'+(mopen?"−":"+")+'</small></button>';
      if(!mopen) return;
      h += calendarGridHTML(m.key, m.list);
      // 오늘 날짜는 달력 아래 '오늘 학습' 섹션에 따로 나오므로 여기서는 뺀다 (같은 카드 중복 방지)
      var picked = m.list.filter(function(d){ return openDays[d.date] && d.date !== TODAY; });
      if(picked.length){
        h += '<div class="indent">' + picked.map(daySectionHTML).join("") + '</div>';
      }
    });
    return h;
  }

  function searchResults(){
    var q = query.trim().toLowerCase();
    var out = [];
    DAYS.forEach(function(day){
      day.sentences.forEach(function(s,i){
        var hay = (s.kr+" "+s.jp+" "+s.yomi+" "+(s.g||"")).toLowerCase();
        if(hay.indexOf(q) >= 0) out.push({day:day, s:s, i:i});
      });
    });
    return out;
  }

  function renderToday(){
    var el = document.getElementById("pane-today");
    var totalLearned = Object.keys(state.learned).filter(function(k){ return state.learned[k]; }).length;
    var streak = calcStreak();
    var strip = last7().map(function(d){
      return '<i class="'+(d.count>0?"hit":"")+'"></i>'; }).join("");

    var h = '<div class="hero">'
      + '<div class="hero-top"><span>누적 '+DATA.totals.days+'일째</span><span class="mono">'
      + (remoteOK ? 'N4 ✓' : 'N4') + '</span></div>'
      + '<div class="hero-nums">'
      + '<div class="hero-num"><b>'+DATA.totals.sentences+'</b><span>총 문장</span></div>'
      + '<div class="hero-num"><b>'+DATA.totals.words+'</b><span>총 단어</span></div>'
      + '<div class="hero-num gold right"><b>'+streak+'</b><span>연속 학습일</span></div>'
      + '</div><div class="week-strip">'+strip+'</div></div>';

    h += '<div class="searchrow"><input class="search" id="q" placeholder="문장 · 단어 · 문법 검색" value="'+esc(query)+'">'
       + '<button class="iconbtn" id="themebtn" aria-label="밝기 전환">◐</button></div>';

    if(query.trim()){
      var res = searchResults();
      h += '<div class="rowbetween"><span class="count">검색 결과 '+res.length+'건</span></div>';
      h += res.length ? '<div class="stack">' + res.map(function(r){
             return '<div class="pill" style="align-self:flex-start">'+esc(r.day.date)+'</div>' + cardHTML(r.day, r.s, r.i);
           }).join("") + '</div>'
         : '<p class="empty">일치하는 문장이 없습니다.</p>';
    } else {
      // 누적 현황(hero) 바로 아래에 달력을 놓고, 오늘 학습은 그 아래에 펼쳐 둔다.
      // 과거 날짜는 달력에서 눌러 달력 바로 밑에 펼치고, 오늘은 전용 섹션이 따로 있다.
      var todayDay = DAYS.filter(function(d){ return d.date === TODAY; })[0];
      if(DAYS.length){
        h += '<div class="grouphead">학습 달력 · 누적 '+DAYS.length+'일</div>' + monthTreeHTML(DAYS);
      }
      if(todayDay) h += daySectionHTML(todayDay);
      if(!DAYS.length) h += '<p class="empty">아직 학습 기록이 없습니다.</p>';
    }
    el.innerHTML = h;
  }

  /* ---------- 단어장 탭 ---------- */
  var masked = true, wfilter = "today", revealed = {};

  function allWords(){
    var out = [];
    DAYS.forEach(function(d){
      (d.words||[]).forEach(function(w){ out.push({word:w.word, reading:w.reading, meaning:w.meaning, date:d.date, topic:d.topic}); });
    });
    return out;
  }
  function wrongCount(){
    var n = 0;
    Object.keys(state.word).forEach(function(k){
      var s = state.word[k]; if(s && s.wrong > (s.right||0)) n++;
    });
    return n;
  }
  function filteredWords(){
    var all = allWords();
    if(wfilter === "today") return all.filter(function(w){ return w.date === TODAY; });
    if(wfilter === "week")  return all.filter(function(w){ return TODAY && dayGap(TODAY, w.date) < 7; });
    if(wfilter === "month") return all.filter(function(w){ return TODAY && monthKey(w.date) === monthKey(TODAY); });
    if(wfilter === "wrong") return all.filter(function(w){ var s = state.word[w.word]; return s && s.wrong > (s.right||0); });
    return all;
  }
  function dotClass(word){
    var s = state.word[word];
    if(!s) return "";
    if(s.wrong > (s.right||0)) return " bad";
    if(s.wrong) return " warn";
    return "";
  }

  function renderWords(){
    var el = document.getElementById("pane-words");
    var list = filteredWords();
    var chips = [["today","오늘 "+allWords().filter(function(w){return w.date===TODAY;}).length],
                 ["week","최근 7일"],["month","이번 달"],
                 ["wrong","틀린 단어 "+wrongCount()],["all","전체"]];
    var h = '<div class="rowbetween"><h2 class="h2">단어장</h2><span class="count">'+DATA.totals.words+' 단어</span></div>';
    var qn = Math.min(20, Math.max(list.length, 0));
    h += '<div class="actions">'
       + '<button class="btn" id="maskbtn">'+(masked?"뜻 보이기":"뜻 가리기")+'</button>'
       + '<button class="btn ghost" id="quizbtn">퀴즈 '+qn+'문항</button></div>';
    h += '<div class="filters">' + chips.map(function(c){
         return '<button class="fchip'+(wfilter===c[0]?" on":"")+'" data-f="'+c[0]+'">'+esc(c[1])+'</button>'; }).join("") + '</div>';
    h += '<div class="stack">' + (list.length ? list.map(function(w,i){
      var show = !masked || revealed[w.word+i];
      return '<div class="wrow" role="button" tabindex="0" data-w="'+esc(w.word)+'" data-i="'+i+'">'
        + '<span class="w"><b class="jp">'+esc(w.word)+'</b><span class="jp">'+esc(w.reading)+'</span></span>'
        + (show ? '<span class="mean">'+esc(w.meaning)+'</span>'
                : '<span class="mask">탭하여 확인</span>')
        + '<span class="dot'+dotClass(w.word)+'"></span>'
        + '<button class="wplay" data-speak="'+esc(w.reading||w.word)+'" aria-label="'+esc(w.word)+' 발음 듣기">♪</button>'
        + '</div>';
    }).join("") : '<p class="empty">해당하는 단어가 없습니다.</p>') + '</div>';
    el.innerHTML = h;
  }

  /* ---------- 통계 탭 ---------- */
  function last7(){
    var out = [];
    if(!TODAY) return out;
    var base = parseDate(TODAY);
    for(var k=6;k>=0;k--){
      var d = new Date(base.getTime() - k*86400000);
      var key = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
      var c = 0;
      Object.keys(state.learned).forEach(function(id){ if(state.learned[id] && id.split("#")[0] === key) c++; });
      out.push({key:key, wd:"일월화수목금토".charAt(d.getDay()), count:c, today:key===TODAY});
    }
    return out;
  }
  function calcStreak(){
    var active = {};
    Object.keys(state.learned).forEach(function(id){ if(state.learned[id]) active[id.split("#")[0]] = 1; });
    (state.quiz||[]).forEach(function(q){ active[q.date] = 1; });
    if(!TODAY) return 0;
    var n = 0, cur = parseDate(TODAY);
    for(var i=0;i<400;i++){
      var key = cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0");
      if(active[key]) n++; else if(i>0) break; else { /* 오늘 아직 학습 전이면 어제부터 센다 */ }
      cur = new Date(cur.getTime() - 86400000);
    }
    return n;
  }
  function grammarStats(){
    var m = {};
    DAYS.forEach(function(d){
      d.sentences.forEach(function(s,i){
        var g = s.g || "기타";
        if(!m[g]) m[g] = {total:0, done:0};
        m[g].total++;
        if(state.learned[sid(d.date,i)]) m[g].done++;
      });
    });
    return Object.keys(m).map(function(g){
      return {g:g, pct: Math.round(m[g].done / m[g].total * 100), total:m[g].total};
    }).sort(function(a,b){ return a.pct - b.pct; });
  }

  function renderStats(){
    var el = document.getElementById("pane-stats");
    var learnedTotal = Object.keys(state.learned).filter(function(k){ return state.learned[k]; }).length;
    var qs = state.quiz || [];
    var qTot = qs.reduce(function(a,q){ return a + q.total; }, 0);
    var qRight = qs.reduce(function(a,q){ return a + q.correct; }, 0);
    var acc = qTot ? Math.round(qRight/qTot*100) + "%" : "—";
    var streak = calcStreak();
    var days = last7();
    var max = Math.max.apply(null, days.map(function(d){ return d.count; }).concat([1]));

    var active = {};
    Object.keys(state.learned).forEach(function(id){ if(state.learned[id]) active[id.split("#")[0]] = 1; });
    var cells = "";
    for(var k=15;k>=0;k--){
      var d = new Date(parseDate(TODAY || "2026-01-01").getTime() - k*86400000);
      var key = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
      cells += '<i class="'+(active[key]?"hit":"")+'"></i>';
    }

    var h = '<h2 class="h2">학습 통계</h2>';
    h += '<div class="streak"><div class="l"><i>연속 학습</i><b>'+streak+'일</b>'
       + '<span>누적 '+DATA.totals.days+'일 · 학습한 문장 '+learnedTotal+'</span></div>'
       + '<div class="grid16">'+cells+'</div></div>';
    h += '<div class="tiles"><div class="tile"><span>학습 체크한 문장</span><b>'+learnedTotal.toLocaleString()+'</b></div>'
       + '<div class="tile"><span>퀴즈 정답률</span><b>'+acc+'</b></div></div>';
    h += '<div class="panel"><div class="ph"><b>최근 7일 학습량</b><span>문장 수</span></div><div class="bars">'
       + days.map(function(d){
           var hgt = Math.max(8, Math.round(d.count / max * 88));
           return '<div class="'+(d.today?"now":"")+'"><i class="'+(d.today?"today":"")+'" style="height:'+hgt+'px"></i><span>'+d.wd+'</span></div>';
         }).join("") + '</div></div>';

    // 지금까지 배운 문법을 전부 보여준다 (예전에는 4개만 잘라서 보여줬다)
    var gs = grammarStats();
    var gTotal = gs.reduce(function(a,x){ return a + x.total; }, 0);
    h += '<div class="panel"><div class="ph"><b>문법별 학습률</b><span>'
       + gs.length + '개 문법 · ' + gTotal + '문장</span></div>'
       + '<div style="display:flex;flex-direction:column;gap:12px">'
       + (gs.length ? gs.map(function(x){
           var cls = x.pct < 40 ? " bad" : (x.pct < 70 ? " warn" : "");
           return '<div class="gline"><b class="jp">'+esc(x.g)+'</b>'
             + '<span class="track"><i class="'+cls.trim()+'" style="width:'+Math.max(x.pct,2)+'%"></i></span>'
             + '<span>'+x.pct+'%</span></div>';
         }).join("") : '<p class="empty">문장을 학습 체크하면 문법별 진도가 표시됩니다.</p>')
       + '</div></div>';
    el.innerHTML = h;
  }

  /* ---------- 퀴즈 ---------- */
  var quiz = null;
  function startQuiz(){
    var pool = filteredWords();
    if(pool.length < 4){ pool = allWords(); }
    if(pool.length < 4){ alert("퀴즈를 만들려면 단어가 4개 이상 필요합니다."); return; }
    var shuffled = pool.slice().sort(function(){ return Math.random()-0.5; });
    var items = shuffled.slice(0, Math.min(20, shuffled.length)).map(function(w){
      var wrong = pool.filter(function(x){ return x.meaning !== w.meaning; })
                      .sort(function(){ return Math.random()-0.5; }).slice(0,3);
      var opts = wrong.map(function(x){ return x.meaning; }).concat([w.meaning])
                      .sort(function(){ return Math.random()-0.5; });
      return {w:w, opts:opts};
    });
    quiz = {items:items, idx:0, sel:null, checked:false, correct:0};
    document.getElementById("quiz").classList.add("on");
    renderQuiz();
  }
  function endQuiz(){
    document.getElementById("quiz").classList.remove("on");
    quiz = null;
    renderAll();
  }
  function renderQuiz(){
    var el = document.getElementById("quiz");
    if(!quiz) return;
    if(quiz.idx >= quiz.items.length){
      el.innerHTML = '<div class="qdone"><b>'+quiz.correct+' / '+quiz.items.length+'</b>'
        + '<span>틀린 단어는 단어장의 “틀린 단어” 칩에 모입니다.</span></div>'
        + '<div class="qfoot"><button class="cta" id="qclose">단어장으로 돌아가기</button></div>';
      return;
    }
    var it = quiz.items[quiz.idx];
    var h = '<div class="rowbetween"><span class="count">단어 퀴즈</span>'
          + '<span class="count">'+(quiz.idx+1)+' / '+quiz.items.length+'</span></div>';
    h += '<div class="qbar"><i style="width:'+Math.round((quiz.idx)/quiz.items.length*100)+'%"></i></div>';
    h += '<div class="qcard"><b class="jp">'+esc(it.w.word)+'</b><span class="jp">'+esc(it.w.reading)+'</span>'
       + '<em>'+esc(it.w.date.slice(5))+' · '+esc(it.w.topic)+'</em>'
       + '<button class="qplay" data-speak="'+esc(it.w.reading||it.w.word)+'">♪ 발음 듣기</button></div>';
    h += '<div class="opts">' + it.opts.map(function(o,i){
      var cls = "opt";
      if(quiz.checked){
        if(o === it.w.meaning) cls += " right";
        else if(o === quiz.sel) cls += " wrong";
      } else if(o === quiz.sel) cls += " sel";
      return '<button class="'+cls+'" data-o="'+i+'">'+esc(o)+'</button>';
    }).join("") + '</div>';
    h += '<div class="qfoot"><button class="cta" id="qnext"'+(quiz.sel==null&&!quiz.checked?" disabled":"")+'>'
       + (quiz.checked ? (quiz.idx+1 >= quiz.items.length ? "결과 보기" : "다음 문제") : "확인") + '</button>'
       + '<button class="qskip" id="qquit">그만두기</button></div>';
    el.innerHTML = h;
  }

  /* ---------- 렌더 & 이벤트 ---------- */
  function renderAll(){ renderToday(); renderWords(); renderStats(); if(quiz) renderQuiz(); }

  document.addEventListener("click", function(e){
    var t = e.target;
    if(!t || !t.closest) return;

    var nav = t.closest(".nav button");
    if(nav){
      document.querySelectorAll(".nav button").forEach(function(b){ b.classList.toggle("on", b === nav); });
      document.querySelectorAll(".pane").forEach(function(p){ p.classList.remove("on"); });
      document.getElementById("pane-" + nav.dataset.tab).classList.add("on");
      window.scrollTo(0,0);
      return;
    }
    if(t.id === "themebtn"){
      var cur = document.documentElement.getAttribute("data-theme");
      var next = cur === "dark" ? "light" : (cur === "light" ? "dark" :
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark"));
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("jp-theme", next); } catch(err){}
      return;
    }

    var sp = t.closest("[data-speak]");
    if(sp){ e.stopPropagation(); speak(sp.dataset.speak, sp); return; }

    // 문장 속 단어를 탭하면 그 단어의 뜻을 카드 안에 펼친다 (같은 단어를 다시 누르면 닫힘)
    var tw = t.closest("[data-tw]");
    if(tw){
      var twCard = tw.closest(".card");
      if(twCard){
        var twId = twCard.dataset.id;
        openWords[twId] = (openWords[twId] === tw.dataset.tw) ? "" : tw.dataset.tw;
        renderToday();
      }
      return;
    }

    var act = t.closest("[data-act]");
    if(act){
      var card = act.closest(".card"), id = card.dataset.id;
      var parts = id.split("#"), day = DAYS.filter(function(d){ return d.date === parts[0]; })[0];
      var s = day.sentences[+parts[1]];
      if(act.dataset.act === "toggle"){ openCards[id] = !openCards[id]; renderToday(); }
      else if(act.dataset.act === "done"){
        state.learned[id] = !state.learned[id];
        markVisit(); save(); renderAll();
      } else if(act.dataset.act === "speak"){
        speak(s.jp, act);
      }
      return;
    }

    var dh = t.closest("[data-day]");
    if(dh){ var k = dh.dataset.day; openDays[k] = !openDays[k]; renderToday(); return; }
    var mo = t.closest("[data-month]");
    if(mo){ var mkey = mo.dataset.month; openMonths[mkey] = !openMonths[mkey]; renderToday(); return; }

    if(t.id === "maskbtn"){ masked = !masked; revealed = {}; renderWords(); return; }
    if(t.id === "quizbtn"){ startQuiz(); return; }
    var fc = t.closest("[data-f]");
    if(fc){ wfilter = fc.dataset.f; revealed = {}; renderWords(); return; }
    var wr = t.closest(".wrow");
    if(wr && masked){ revealed[wr.dataset.w + wr.dataset.i] = true; renderWords(); return; }

    var opt = t.closest("[data-o]");
    if(opt && quiz && !quiz.checked){ quiz.sel = quiz.items[quiz.idx].opts[+opt.dataset.o]; renderQuiz(); return; }
    if(t.id === "qnext" && quiz){
      if(!quiz.checked){
        quiz.checked = true;
        var it = quiz.items[quiz.idx], w = it.w.word;
        if(!state.word[w]) state.word[w] = {right:0, wrong:0};
        if(quiz.sel === it.w.meaning){ quiz.correct++; state.word[w].right++; }
        else state.word[w].wrong++;
        save();
      } else {
        quiz.idx++; quiz.sel = null; quiz.checked = false;
        if(quiz.idx >= quiz.items.length){
          state.quiz.push({date:TODAY, correct:quiz.correct, total:quiz.items.length, at:Date.now()});
          markVisit(); save();
        }
      }
      renderQuiz();
      return;
    }
    if(t.id === "qquit" || t.id === "qclose"){ endQuiz(); return; }
  });

  document.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var row = e.target.closest && e.target.closest(".wrow");
    if(row && masked){ e.preventDefault(); revealed[row.dataset.w + row.dataset.i] = true; renderWords(); }
  });

  document.addEventListener("input", function(e){
    if(e.target.id === "q"){
      query = e.target.value;
      renderToday();
      var box = document.getElementById("q");
      if(box){ box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    }
  });

  try {
    var saved = localStorage.getItem("jp-theme");
    if(saved) document.documentElement.setAttribute("data-theme", saved);
  } catch(e){}

  renderAll();
})();
