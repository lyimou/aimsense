/**
 * Interface strings, English and Chinese.
 *
 * Kept as plain data with zero dependencies and no build step, like the rest of
 * the project. Keys are dotted paths grouped by where they appear.
 *
 * `{name}` placeholders are substituted by `t()`.
 *
 * A note on the Chinese: it is written in Traditional Chinese, matching the
 * author's other writing. Technical terms keep their conventional gaming form
 * (cm/360, eDPI, DPI, flick, track) because that is what players actually say;
 * translating them would make the tool harder to use, not easier.
 */

export const DEFAULT_LOCALE = 'en';
export const LOCALES = ['en', 'zh'];

export const MESSAGES = {
  en: {
    'meta.title': 'AimSense — Mouse Sensitivity Testing & Recommendation',
    'meta.description':
      'Test your FPS mouse sensitivity in the browser. Three aim tests, a sensitivity sweep, and a recommended cm/360 with a visual report. No sign-up, no data leaves your machine.',
    'meta.htmlLang': 'en',

    'a11y.skip': 'Skip to content',
    'a11y.sections': 'Sections',
    'a11y.testPlan': 'Test plan',
    'a11y.aimTestArea': 'Aim test area',
    'a11y.langToggle': 'Switch language',

    'nav.setup': 'Setup',
    'nav.test': 'Test',
    'nav.report': 'Report',
    'nav.about': 'About',
    'nav.github': 'GitHub',

    'hero.title': 'Find your sensitivity.',
    'hero.lede':
      'Guessing at sensitivity costs you months. This measures it: three aim tests at three different sensitivities, scored against each other, then fitted to find your peak. Everything runs in your browser — nothing is uploaded.',
    'hero.pill.minutes': '~9 minutes',
    'hero.pill.modes': '3 test modes',
    'hero.pill.rounds': '9 rounds',
    'hero.pill.noSignup': 'No sign-up',

    'setup.title': '1 · Your current settings',
    'setup.dpi': 'Mouse DPI',
    'setup.dpiHint': 'Check your mouse software or its manual.',
    'setup.game': 'Game',
    'setup.game.other': 'Other / unknown',
    'setup.sens': 'In-game sensitivity',
    'setup.sens.optional': '(optional)',
    'setup.sensHint': 'Leave blank to still get a ×multiplier recommendation.',
    'setup.derived': 'Derived',
    'setup.out.cm': 'cm/360',
    'setup.out.edpi': 'eDPI',
    'setup.out.band': 'Band',
    'setup.conversion': 'Yaw constant {yaw}°/count for {game}.',
    'setup.addSens': 'Add your in-game sensitivity to see exact figures.',
    'setup.verifiedHint': 'Conversion constant verified for this game.',
    'setup.unverifiedHint':
      'Conversion constant for this game is approximate — treat cm/360 as an estimate.',
    'setup.equivalent': 'Equivalent: {list}',
    'setup.howTitle': 'How cm/360 works',
    'setup.howBody':
      'cm/360 is the distance you must move the mouse to turn a full circle in game. Unlike eDPI it is comparable between games and between DPI settings, so it is what this tool optimises. It is exact, not empirical: <code>cm/360 = 360 / (DPI × sensitivity × yaw)</code>, where <code>yaw</code> is a constant each game publishes.',

    'err.dpi': 'Enter a DPI between 50 and 32000.',
    'err.sens': 'Sensitivity must be a positive number, or left blank.',

    'test.title': '2 · The test',
    'test.intro':
      'You will play each mode at three sensitivities. Use the same mouse setting you normally play with — the tool changes only the in-test multiplier, so no re-configuring is needed between rounds.',
    'test.mode.flick': 'Flick',
    'test.mode.track': 'Track',
    'test.mode.micro': 'Micro-adjust',
    'test.mode.flick.desc':
      'Targets appear one at a time. Click them. Measures hit rate, reaction time and how close to the centre you land.',
    'test.mode.track.desc':
      'A target wanders. Hold the button and stay on it. Measures time-on-target and average deviation.',
    'test.mode.micro.desc': 'Small, precise corrections. Measures accuracy and fine control.',
    'test.plan.sensitivities': 'Sensitivities',
    'test.plan.perSensitivity': 'Per sensitivity',
    'test.plan.perSensitivityValue': 'Flick 10 targets · Track 30s · Micro 10 targets',
    'test.pointerNotice':
      'This test needs a mouse. A touch device was detected — results will not be meaningful.',
    'test.start': 'Start full sweep',
    'test.quick': 'Quick test (flick only)',
    'test.hint':
      'The full sweep is 9 short rounds. The quick test is 3 rounds and only looks at flick performance — useful for a first look, less reliable for a recommendation.',
    'test.hud.stage': 'Stage',
    'test.hud.sensitivity': 'Sensitivity',
    'test.hud.round': 'Round',
    'test.hud.progress': 'Progress',
    'test.abort': 'Abort',
    'test.abortConfirm': 'Abort the test? This round will not be scored.',
    'test.canvasHint': 'Click the area to lock the mouse and begin.',
    'test.status.lock': '{label}: click the test area to lock the mouse.',
    'test.status.running': '{mode} at {mult}× — {done}/{total} rounds done.',
    'test.status.paused': 'Paused — click the test area to resume.',
    'test.status.click': 'Click the test area to lock the mouse. Press Esc to release.',
    'test.status.noRounds': 'No rounds completed.',
    'test.status.failed': 'Something went wrong running the test. Reload and try again.',
    'test.pause.pointerLock': 'Paused — mouse left the test area',
    'test.pause.blur': 'Paused — window lost focus',
    'test.pause.hidden': 'Paused — tab was hidden',
    'test.pause.generic': 'Paused',
    'test.pause.resume': 'Click the canvas to resume',
    'test.avgDeviation': 'avg deviation: {pct}% of radius',
    'test.plan.full': 'Full sweep',
    'test.plan.quick': 'Quick test',

    'report.title': '3 · Your report',
    'report.recommendedSensitivity': 'Recommended sensitivity',
    'report.current': 'Current',
    'report.recommended': 'Recommended',
    'report.inGameSens': 'In-game sens',
    'report.why': 'Why this number',
    'report.verdictWithSens':
      'Set your in-game sensitivity to {sens} · {cm} cm/360',
    'report.verdictCmOnly': '{cm} cm/360',
    'report.verdictNoSens': 'Add your in-game sensitivity in setup for exact figures.',
    'report.chartCurve': 'Score vs sensitivity',
    'report.chartCurveSub': '(higher is better)',
    'report.chartRadar': 'Accuracy by mode and sensitivity',
    'report.chartReaction': 'Reaction time per round',
    'report.chartReactionSub': '(flick / micro)',
    'report.chartRadialError': 'Accuracy',
    'report.chartRadialErrorSub': '(mean distance from target centre — shorter is better)',
    'report.chartOnTarget': 'Time on target',
    'report.chartOnTargetSub': '(track mode)',
    'report.tableCaption': 'Round-by-round detail',
    'report.col.mode': 'Mode',
    'report.col.sens': 'Sens',
    'report.col.hitRate': 'Hit rate',
    'report.col.avgReaction': 'Avg reaction',
    'report.col.meanError': 'Mean error',
    'report.col.onTarget': 'On target',
    'report.copy': 'Copy results',
    'report.copied': 'Copied',
    'report.copyFailed': 'Copy failed',
    'report.retest': 'Retest',
    'report.download': 'Download JSON',
    'report.history.summary': 'Saved tests on this device',
    'report.history.clear': 'Clear saved tests',
    'report.history.clearConfirm': 'Delete all saved tests on this device?',
    'report.history.empty': 'No saved tests yet.',
    'report.history.rounds': '{n} rounds · {dpi} DPI',
    'report.history.quota': 'Could not save: browser storage is full.',
    'report.history.unavailable':
      'Could not save: browser storage is unavailable (private mode?).',

    'chart.radarNeedsTwo': 'A radar needs two or more test modes',
    'chart.radarRunFull': 'Run the full sweep to compare modes',
    'chart.reactionNone': 'No reaction-time data — only flick and micro record it',
    'chart.radialErrorNone': 'No accuracy data',
    'chart.radialErrorAxis': 'mean distance from target centre (px) — shorter is better',
    'chart.onTargetNone': 'Only track mode reports on-target time',
    'chart.ms': 'ms',
    'chart.recommended': 'rec',

    'about.title': 'About',
    'about.p1':
      'AimSense compares you against yourself, not against a population. There is no public benchmark for "good" aim, so instead it tests the same player at three sensitivities and fits a curve through the results. That is why the recommendation is a multiplier of your current setting rather than an absolute number to copy from someone else.',
    'about.scoreLead': 'What the score means.',
    'about.scoreBody':
      'Each mode produces metrics on a different scale, so each is normalised to 0–1 and combined: flick weights hit rate highest, then speed, then how cleanly you stop; tracking is time-on-target plus steadiness; micro-adjust is accuracy plus precision. Precision is the mean distance from the target centre, so arriving short and flying past cost exactly the same.',
    'about.limitsLead': 'Limits, stated plainly.',
    'about.limitsBody':
      'This measures a small sample of your aim on one day. Fatigue, warm-up, mousepad and sleep all move the numbers. If all three sensitivities score within a few points of each other the app says so and recommends no change, because a confident-sounding number from flat data would be a lie.',
    'about.privacy':
      "Nothing is uploaded. Results are stored in your browser's local storage and never leave the device.",
    'about.builtBy': 'Built by',
    'about.source': 'Source:',

    'footer.by': 'AimSense',

    'lang.switchTo': '中文',

    'rec.flat':
      'All three sensitivities scored within {spread} points of each other ({list}), so the data does not justify a change. Keep your current setting.',
    'rec.parabola':
      'Your scores fitted a downward curve ({list}), and the peak of that curve sits at {mult}× your current sensitivity — about {pct}.',
    'rec.edge':
      'Your best score was at the edge of the tested range ({list}), with the curve still rising at {mult}× — beyond what was tested. Lower your in-game sensitivity and run the sweep again to explore further.',
    'rec.observedBest':
      'The curve fit was not reliable with these samples, so the recommendation is the best score actually observed ({list}) at {mult}×.',
    'rec.conf.high':
      'Confidence: high — three distinct points with a clear peak inside the tested range.',
    'rec.conf.medium': 'Confidence: medium — based on fewer than three distinct sensitivities.',
    'rec.conf.none': 'Confidence: none — read this as "no change needed", not as a measurement.',
    'rec.conf.low':
      'Confidence: low — the recommendation sits at or beyond the edge of what was tested.',

    'band.very-high': 'very high (low cm/360)',
    'band.high': 'high',
    'band.medium': 'medium',
    'band.low': 'low',
    'band.very-low': 'very low (high cm/360)',
    'band.unknown': 'unknown',

    'game.cs2': 'CS2',
    'game.valorant': 'Valorant',
    'game.apex': 'Apex Legends',
    'game.overwatch': 'Overwatch 2',

    'share.title': 'AimSense — sensitivity test result',
    'share.game': 'Game:',
    'share.dpi': 'DPI:',
    'share.sens': 'In-game sens:',
    'share.notProvided': 'not provided',
    'share.current': 'Current:',
    'share.recommended': 'RECOMMENDED: {mult}× your current sensitivity',
    'share.setSens': '  → set in-game sens to {sens}',
    'share.applyManually': '  → (in-game sens not provided, apply the multiplier manually)',
    'share.confidence': 'Confidence:',
    'share.scores': 'Scores by sensitivity (0–100):',
    'share.rounds': 'Rounds played:',
    'share.footer': 'Tested with AimSense — https://lyimou.github.io/aimsense/',
    'share.approxNote': '(Game conversion is approximate.)',
  },

  zh: {
    'meta.title': 'AimSense — 滑鼠靈敏度測試與建議',
    'meta.description':
      '在瀏覽器裡測試你的 FPS 滑鼠靈敏度。三種瞄準測試、三段靈敏度掃描，並附上建議 cm/360 與視覺化報告。免註冊，資料不離開你的電腦。',
    'meta.htmlLang': 'zh-Hant',

    'a11y.skip': '跳至主要內容',
    'a11y.sections': '頁面區塊',
    'a11y.testPlan': '測試計畫',
    'a11y.aimTestArea': '瞄準測試區',
    'a11y.langToggle': '切換語言',

    'nav.setup': '設定',
    'nav.test': '測試',
    'nav.report': '報告',
    'nav.about': '關於',
    'nav.github': 'GitHub',

    'hero.title': '找出你的靈敏度。',
    'hero.lede':
      '用猜的調靈敏度，代價是好幾個月。這工具把它量出來：用三種靈敏度各做三項瞄準測試，互相比較後擬合出你的最佳值。全部在你的瀏覽器裡執行 —— 不會上傳任何資料。',
    'hero.pill.minutes': '約 9 分鐘',
    'hero.pill.modes': '3 種測試模式',
    'hero.pill.rounds': '9 個回合',
    'hero.pill.noSignup': '免註冊',

    'setup.title': '1 · 你目前的設定',
    'setup.dpi': '滑鼠 DPI',
    'setup.dpiHint': '請查閱你的滑鼠軟體或說明書。',
    'setup.game': '遊戲',
    'setup.game.other': '其他 / 未知',
    'setup.sens': '遊戲內靈敏度',
    'setup.sens.optional': '（選填）',
    'setup.sensHint': '留空仍然可以得到「×倍率」的建議。',
    'setup.derived': '換算結果',
    'setup.out.cm': 'cm/360',
    'setup.out.edpi': 'eDPI',
    'setup.out.band': '區間',
    'setup.conversion': '{game} 的 yaw 常數為 {yaw}°/count。',
    'setup.addSens': '填入你的遊戲內靈敏度，即可看到精確數值。',
    'setup.verifiedHint': '這款遊戲的換算常數已驗證。',
    'setup.unverifiedHint': '這款遊戲的換算常數僅為近似值 —— 請把 cm/360 當作估計值。',
    'setup.equivalent': '等效數值：{list}',
    'setup.howTitle': 'cm/360 是什麼',
    'setup.howBody':
      'cm/360 是你在遊戲中轉整整一圈，滑鼠必須移動的距離。和 eDPI 不同，它可以在不同遊戲、不同 DPI 設定之間互相比較，所以本工具以它為最佳化目標。它是精確換算而非經驗估計：<code>cm/360 = 360 / (DPI × sensitivity × yaw)</code>，其中 <code>yaw</code> 是各遊戲公布的常數。',

    'err.dpi': '請輸入 50 到 32000 之間的 DPI。',
    'err.sens': '靈敏度必須是正數，或留空。',

    'test.title': '2 · 測試',
    'test.intro':
      '你會用三種靈敏度各玩一次每種模式。請使用你平常習慣的滑鼠設定 —— 本工具只改變測試中的倍率，所以回合之間不需要重新設定。',
    'test.mode.flick': '甩槍',
    'test.mode.track': '追蹤',
    'test.mode.micro': '微調',
    'test.mode.flick.desc': '目標一次出現一個，點掉它。測量命中率、反應時間，以及你落點離中心多近。',
    'test.mode.track.desc': '目標會游走。按住按鍵並把準心留在目標上。測量停留時間與平均偏差。',
    'test.mode.micro.desc': '小幅而精準的修正。測量準確度與細部控制。',
    'test.plan.sensitivities': '靈敏度',
    'test.plan.perSensitivity': '每段靈敏度',
    'test.plan.perSensitivityValue': '甩槍 10 個目標 · 追蹤 30 秒 · 微調 10 個目標',
    'test.pointerNotice': '本測試需要滑鼠。偵測到觸控裝置 —— 結果將不具參考意義。',
    'test.start': '開始完整掃描',
    'test.quick': '快速測試（僅甩槍）',
    'test.hint':
      '完整掃描是 9 個短回合。快速測試是 3 個回合，只看甩槍表現 —— 適合先試水溫，用來下建議較不可靠。',
    'test.hud.stage': '階段',
    'test.hud.sensitivity': '靈敏度',
    'test.hud.round': '回合',
    'test.hud.progress': '進度',
    'test.abort': '中止',
    'test.abortConfirm': '要中止測試嗎？本回合將不會計分。',
    'test.canvasHint': '點擊此區域以鎖定滑鼠並開始。',
    'test.status.lock': '{label}：點擊測試區以鎖定滑鼠。',
    'test.status.running': '{mode}，{mult}× —— 已完成 {done}/{total} 回合。',
    'test.status.paused': '已暫停 —— 點擊測試區繼續。',
    'test.status.click': '點擊測試區以鎖定滑鼠。按 Esc 可解除。',
    'test.status.noRounds': '沒有完成任何回合。',
    'test.status.failed': '執行測試時發生錯誤。請重新載入後再試一次。',
    'test.pause.pointerLock': '已暫停 —— 滑鼠離開了測試區',
    'test.pause.blur': '已暫停 —— 視窗失去焦點',
    'test.pause.hidden': '已暫停 —— 分頁被切換到背景',
    'test.pause.generic': '已暫停',
    'test.pause.resume': '點擊畫布以繼續',
    'test.avgDeviation': '平均偏差：半徑的 {pct}%',
    'test.plan.full': '完整掃描',
    'test.plan.quick': '快速測試',

    'report.title': '3 · 你的報告',
    'report.recommendedSensitivity': '建議靈敏度',
    'report.current': '目前',
    'report.recommended': '建議',
    'report.inGameSens': '遊戲內靈敏度',
    'report.why': '為什麼是這個數字',
    'report.verdictWithSens': '把遊戲內靈敏度設為 {sens} · {cm} cm/360',
    'report.verdictCmOnly': '{cm} cm/360',
    'report.verdictNoSens': '請在設定中填入遊戲內靈敏度，以取得精確數值。',
    'report.chartCurve': '分數與靈敏度',
    'report.chartCurveSub': '（越高越好）',
    'report.chartRadar': '各模式與各靈敏度的準確度',
    'report.chartReaction': '各回合反應時間',
    'report.chartReactionSub': '（甩槍 / 微調）',
    'report.chartRadialError': '準確度',
    'report.chartRadialErrorSub': '（離目標中心的平均距離 —— 越短越好）',
    'report.chartOnTarget': '停留在目標上的時間',
    'report.chartOnTargetSub': '（追蹤模式）',
    'report.tableCaption': '逐回合明細',
    'report.col.mode': '模式',
    'report.col.sens': '靈敏度',
    'report.col.hitRate': '命中率',
    'report.col.avgReaction': '平均反應',
    'report.col.meanError': '平均誤差',
    'report.col.onTarget': '停留目標',
    'report.copy': '複製結果',
    'report.copied': '已複製',
    'report.copyFailed': '複製失敗',
    'report.retest': '重新測試',
    'report.download': '下載 JSON',
    'report.history.summary': '這台裝置上已儲存的測試',
    'report.history.clear': '清除已儲存的測試',
    'report.history.clearConfirm': '要刪除這台裝置上所有已儲存的測試嗎？',
    'report.history.empty': '還沒有儲存的測試。',
    'report.history.rounds': '{n} 回合 · {dpi} DPI',
    'report.history.quota': '無法儲存：瀏覽器儲存空間已滿。',
    'report.history.unavailable': '無法儲存：瀏覽器儲存空間無法使用（無痕模式？）。',

    'chart.radarNeedsTwo': '雷達圖需要兩種以上的測試模式',
    'chart.radarRunFull': '執行完整掃描即可比較各模式',
    'chart.reactionNone': '沒有反應時間資料 —— 只有甩槍與微調會記錄',
    'chart.radialErrorNone': '沒有準確度資料',
    'chart.radialErrorAxis': '離目標中心的平均距離（px）—— 越短越好',
    'chart.onTargetNone': '只有追蹤模式會回報停留目標時間',
    'chart.ms': '毫秒',
    'chart.recommended': '建議',

    'about.title': '關於',
    'about.p1':
      'AimSense 是拿你和你自己比較，而不是和一群人比較。所謂「好」的瞄準並沒有公開基準，所以它改為讓同一位玩家在三種靈敏度下受測，再對結果擬合出一條曲線。這就是為什麼建議值是你目前設定的倍率，而不是一個可以直接抄別人的絕對數字。',
    'about.scoreLead': '分數代表什麼。',
    'about.scoreBody':
      '每種模式產生的指標尺度不同，因此各自正規化到 0–1 後再加權合併：甩槍最看重命中率，其次是速度，再來是收得多乾淨；追蹤是停留目標時間加上穩定度；微調是準確度加上精準度。精準度指的是離目標中心的平均距離，所以停得太短和衝過頭，代價完全相同。',
    'about.limitsLead': '直說限制。',
    'about.limitsBody':
      '這只量測你某一天的一小段表現。疲勞、熱身、滑鼠墊和睡眠都會影響數字。如果三種靈敏度的分數相差只有幾分，程式會直接告訴你並建議不要改 —— 因為從一攤平資料擠出一個聽起來很肯定的數字，是在說謊。',
    'about.privacy': '不會上傳任何東西。結果存在你瀏覽器的本機儲存空間，永遠不離開這台裝置。',
    'about.builtBy': '作者',
    'about.source': '原始碼：',

    'footer.by': 'AimSense',

    'lang.switchTo': 'English',

    'rec.flat':
      '三種靈敏度的分數彼此相差在 {spread} 分以內（{list}），資料不足以支持改變。請維持你目前的設定。',
    'rec.parabola':
      '你的分數擬合出一條開口向下的曲線（{list}），曲線的頂點落在你目前靈敏度的 {mult}× —— 大約 {pct}。',
    'rec.edge':
      '你的最高分落在測試範圍的邊緣（{list}），而曲線在 {mult}× 仍在上升 —— 已經超出實測範圍。請調低遊戲內靈敏度後再跑一次掃描，以探索更廣的範圍。',
    'rec.observedBest':
      '這組樣本的曲線擬合不可靠，因此建議值直接採用實際觀測到的最高分（{list}），落在 {mult}×。',
    'rec.conf.high': '信心水準：高 —— 三個相異點，且峰值明確落在實測範圍內。',
    'rec.conf.medium': '信心水準：中 —— 相異的靈敏度少於三個。',
    'rec.conf.none': '信心水準：無 —— 請把它讀成「不需要改」，而不是一次量測結果。',
    'rec.conf.low': '信心水準：低 —— 建議值落於實測範圍的邊緣或之外。',

    'band.very-high': '非常高（cm/360 偏低）',
    'band.high': '偏高',
    'band.medium': '中等',
    'band.low': '偏低',
    'band.very-low': '非常低（cm/360 偏高）',
    'band.unknown': '未知',

    'game.cs2': 'CS2',
    'game.valorant': 'Valorant',
    'game.apex': 'Apex Legends',
    'game.overwatch': 'Overwatch 2',

    'share.title': 'AimSense —— 靈敏度測試結果',
    'share.game': '遊戲：',
    'share.dpi': 'DPI：',
    'share.sens': '遊戲內靈敏度：',
    'share.notProvided': '未提供',
    'share.current': '目前：',
    'share.recommended': '建議：你目前靈敏度的 {mult}×',
    'share.setSens': '  → 把遊戲內靈敏度設為 {sens}',
    'share.applyManually': '  → （未提供遊戲內靈敏度，請自行套用此倍率）',
    'share.confidence': '信心水準：',
    'share.scores': '各靈敏度分數（0–100）：',
    'share.rounds': '遊玩回合數：',
    'share.footer': '以 AimSense 測試 —— https://lyimou.github.io/aimsense/',
    'share.approxNote': '（遊戲換算為近似值。）',
  },
};
