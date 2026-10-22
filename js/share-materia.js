/* =========================================================
   Compartilhar matéria — baseado no Share Dock (Modelo 2).

   Duas áreas no cartão:
   1) STORIES  — Instagram Stories, Facebook Stories e Status do
      WhatsApp. Um toque abre direto o menu de compartilhamento do
      aparelho com a arte 1080x1920 da matéria (com a foto, se houver)
      já anexada. Sem janela, sem tutorial. Sem suporte a compartilhar
      arquivos (computador), baixa a imagem.
   2) COMPARTILHAMENTO PADRÃO — WhatsApp, Facebook, X, LinkedIn,
      Telegram, E-mail, Copiar link e "Mais opções" (menu nativo).

   ES5 puro (sem arrow functions, sem NodeList.forEach, sem
   Element.closest) para não quebrar em navegadores antigos.
   ========================================================= */
(function () {
    'use strict';

    /* ---------------- utilitários compatíveis ---------------- */
    var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };
    var closest = function (el, sel) {
        var m = Element.prototype.matches || Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;
        while (el && el.nodeType === 1) { if (m.call(el, sel)) { return el; } el = el.parentNode; }
        return null;
    };
    var hasClass = function (el, c) { return (' ' + el.className + ' ').indexOf(' ' + c + ' ') > -1; };
    var addClass = function (el, c) { if (!hasClass(el, c)) { el.className += ' ' + c; } };
    var removeClass = function (el, c) { el.className = (' ' + el.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, ''); };
    var isMobile = function () {
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS se apresenta como Mac
    };

    /* ---------------- dados da matéria ---------------- */
    function pageUrl() { // canonical > og:url > endereço atual
        var c = document.querySelector('link[rel="canonical"]');
        var og = document.querySelector('meta[property="og:url"]');
        return (c && c.href) || (og && og.content) || location.href;
    }
    function pageTitle() { // H1 > og:title > <title>
        var h1 = document.querySelector('.hero-title');
        var og = document.querySelector('meta[property="og:title"]');
        return (h1 && h1.textContent.replace(/\s+/g, ' ').trim()) || (og && og.content) || document.title;
    }
    // Foto da matéria: 1ª imagem do corpo; se não houver, a imagem de compartilhamento (og:image)
    function pagePhoto() {
        var img = document.querySelector('.article-body img');
        if (img && (img.currentSrc || img.src)) { return img.currentSrc || img.src; }
        var og = document.querySelector('meta[property="og:image"]');
        return og && og.content ? og.content : null;
    }

    var builders = {
        whatsapp: function (u, t) { return 'https://api.whatsapp.com/send?text=' + encodeURIComponent(t + ' ' + u); },
        facebook: function (u) { return 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(u); },
        x: function (u, t) { return 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(u) + '&text=' + encodeURIComponent(t); },
        linkedin: function (u) { return 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(u); },
        telegram: function (u, t) { return 'https://t.me/share/url?url=' + encodeURIComponent(u) + '&text=' + encodeURIComponent(t); },
        email: function (u, t) { return 'mailto:?subject=' + encodeURIComponent(t) + '&body=' + encodeURIComponent(t + '\n\n' + u); }
    };

    /* =========================================================
       ARTE DOS STORIES (canvas 1080x1920)
       ========================================================= */
    var Story = (function () {
        var W = 1080, H = 1920, PAD = 80;
        var COR = { fundo1: '#001533', fundo2: '#003a5c', destaque: '#00B4CC', branco: '#ffffff' };
        var cache = null; // Promise<Blob>, gerada uma vez por página

        // Tenta carregar uma imagem SEM contaminar o canvas, por ordem:
        // 1) a própria URL (data:, mesmo domínio, ou remota com CORS — o servidor de
        //    imagens do PortalFacil libera CORS para o domínio da prefeitura);
        // 2) o otimizador de imagens do próprio portal (/_next/image, mesmo domínio).
        function loadImage(src) {
            if (!src) { return Promise.resolve(null); }
            var tries = [src];
            var remote = /^https?:/i.test(src) && src.indexOf(location.origin + '/') !== 0;
            if (remote && /^https?:$/.test(location.protocol)) {
                tries.push(location.origin + '/_next/image/?url=' + encodeURIComponent(src) + '&w=1080&q=85');
            }
            var attempt = function (i) {
                if (i >= tries.length) { return Promise.resolve(null); }
                return new Promise(function (resolve) {
                    var img = new Image();
                    var url = tries[i];
                    var isRemote = /^https?:/i.test(url) && url.indexOf(location.origin + '/') !== 0;
                    var timer = setTimeout(function () { resolve(null); }, 6000);
                    if (isRemote) { img.crossOrigin = 'anonymous'; }
                    img.onload = function () { clearTimeout(timer); resolve(img.naturalWidth ? img : null); };
                    img.onerror = function () { clearTimeout(timer); resolve(null); };
                    img.src = url;
                }).then(function (img) { return img || attempt(i + 1); });
            };
            return attempt(0);
        }

        function fontsReady() {
            if (!document.fonts || !document.fonts.load) { return Promise.resolve(); }
            return Promise.all([
                document.fonts.load('800 80px Montserrat'),
                document.fonts.load('700 40px "DM Sans"'),
                document.fonts.load('400 30px "DM Sans"')
            ]).then(null, function () {});
        }

        function roundRect(ctx, x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        }

        function wrap(ctx, text, maxW, maxLines) { // quebra em linhas; reticências após maxLines
            var words = text.split(' '), lines = [], line = '';
            for (var i = 0; i < words.length; i++) {
                var test = line ? line + ' ' + words[i] : words[i];
                if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; } else { line = test; }
            }
            if (line) { lines.push(line); }
            if (lines.length > maxLines) {
                lines = lines.slice(0, maxLines);
                var last = lines[maxLines - 1];
                while (ctx.measureText(last + '…').width > maxW && last.length) { last = last.slice(0, -1); }
                lines[maxLines - 1] = last.replace(/\s+\S*$/, '') + '…';
            }
            return lines;
        }

        function drawCover(ctx, img, x, y, w, h) { // como object-fit:cover
            var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
            var s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
            ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
        }

        function draw(data) {
            return Promise.all([loadImage(data.brasao), loadImage(data.foto), fontsReady()]).then(function (r) {
                var brasao = r[0], foto = r[1];
                var cv = document.createElement('canvas');
                cv.width = W; cv.height = H;
                var ctx = cv.getContext('2d');

                // Fundo: degradê institucional + formas suaves
                var g = ctx.createLinearGradient(0, 0, W, H);
                g.addColorStop(0, COR.fundo1); g.addColorStop(1, COR.fundo2);
                ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
                ctx.globalAlpha = 0.10; ctx.fillStyle = COR.destaque;
                ctx.beginPath(); ctx.arc(W - 60, 260, 300, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(-80, H - 380, 360, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;

                // Cabeçalho: brasão + nome da Prefeitura
                var y = 120;
                if (brasao) { ctx.drawImage(brasao, PAD, y, 104, 108); }
                var tx = brasao ? PAD + 132 : PAD;
                ctx.fillStyle = COR.branco; ctx.textBaseline = 'alphabetic';
                ctx.font = '700 40px "DM Sans", Arial, sans-serif';
                ctx.fillText(data.orgao, tx, y + 52);
                ctx.globalAlpha = 0.7; ctx.font = '400 30px "DM Sans", Arial, sans-serif';
                ctx.fillText(data.local, tx, y + 96);
                ctx.globalAlpha = 1;

                // Categoria (pílula)
                y = 320;
                ctx.font = '700 30px "DM Sans", Arial, sans-serif';
                var pw = ctx.measureText(data.categoria).width + 56;
                ctx.fillStyle = COR.destaque; roundRect(ctx, PAD, y, pw, 60, 30); ctx.fill();
                ctx.fillStyle = COR.fundo1; ctx.fillText(data.categoria, PAD + 28, y + 41);

                // Foto da matéria, se houver (cantos arredondados + sombra)
                y = 420;
                var fh = 640;
                if (foto) {
                    ctx.save();
                    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
                    ctx.fillStyle = COR.fundo1; roundRect(ctx, PAD, y, W - PAD * 2, fh, 36); ctx.fill();
                    ctx.restore();
                    ctx.save(); roundRect(ctx, PAD, y, W - PAD * 2, fh, 36); ctx.clip();
                    drawCover(ctx, foto, PAD, y, W - PAD * 2, fh);
                    ctx.restore();
                    y += fh + 80;
                } else {
                    y += 40;
                }

                // Título
                ctx.fillStyle = COR.branco;
                ctx.font = '800 76px Montserrat, "DM Sans", Arial, sans-serif';
                var lines = wrap(ctx, data.titulo, W - PAD * 2, foto ? 5 : 8);
                for (var i = 0; i < lines.length; i++) { ctx.fillText(lines[i], PAD, y + 76 + i * 92); }

                // Rodapé: chamada + endereço do site
                var fy = H - 250;
                ctx.fillStyle = COR.destaque; ctx.fillRect(PAD, fy, 120, 8);
                ctx.fillStyle = COR.branco; ctx.font = '700 44px "DM Sans", Arial, sans-serif';
                ctx.fillText('Leia a matéria completa', PAD, fy + 84);
                ctx.globalAlpha = 0.75; ctx.font = '400 34px "DM Sans", Arial, sans-serif';
                ctx.fillText(data.dominio, PAD, fy + 140);
                ctx.globalAlpha = 1;

                return { blob: toBlob(cv), comFoto: !!foto };
            }).then(function (res) {
                return res.blob.then(function (b) { return { blob: b, comFoto: res.comFoto }; });
            });
        }

        function toBlob(cv) {
            return new Promise(function (resolve, reject) {
                try {
                    if (cv.toBlob) {
                        cv.toBlob(function (b) { if (b) { resolve(b); } else { reject(new Error('toBlob vazio')); } }, 'image/jpeg', 0.92);
                    } else { // navegadores antigos: dataURL -> Blob
                        var bin = atob(cv.toDataURL('image/jpeg', 0.92).split(',')[1]);
                        var arr = new Uint8Array(bin.length);
                        for (var i = 0; i < bin.length; i++) { arr[i] = bin.charCodeAt(i); }
                        resolve(new Blob([arr], { type: 'image/jpeg' }));
                    }
                } catch (err) { reject(err); }
            });
        }

        function collect() {
            var brasao = document.querySelector('.header img, img[alt^="Brasão"]');
            var pill = document.querySelector('.hero-side-pills .pill');
            var host = '';
            try { host = new URL(pageUrl()).hostname.replace(/^www\./, ''); } catch (e) { host = location.hostname; }
            return {
                titulo: pageTitle(),
                orgao: 'Prefeitura de Santana do Paraíso',
                local: 'Minas Gerais · Brasil',
                categoria: (pill && pill.textContent.replace(/\s+/g, ' ').trim()) || 'Notícias',
                brasao: brasao && (brasao.currentSrc || brasao.src),
                foto: pagePhoto(),
                dominio: host
            };
        }

        return {
            // Promise<{blob, comFoto}>: gera uma vez e reaproveita
            prepare: function () {
                if (!cache) {
                    cache = draw(collect());
                    cache.then(null, function () { cache = null; }); // se falhar, permite tentar de novo
                }
                return cache;
            }
        };
    })();

    function fileFrom(blob) {
        var name = 'materia-stories.jpg';
        try { return new File([blob], name, { type: 'image/jpeg' }); } // File() não existe em Safari/Edge antigos
        catch (e) { blob.name = name; return blob; }
    }

    function download(blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        if ('download' in a) {
            a.href = url; a.download = 'materia-stories.jpg';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        } else {
            window.open(url, '_blank'); // iOS antigo: abre a imagem para "Salvar imagem"
        }
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    }

    function copyText(text) { // Clipboard API → execCommand; devolve Promise<boolean>
        var legacy = function () {
            var tmp = document.createElement('textarea');
            tmp.value = text; tmp.setAttribute('readonly', ''); tmp.style.position = 'fixed'; tmp.style.opacity = '0';
            document.body.appendChild(tmp); tmp.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
            document.body.removeChild(tmp);
            return ok;
        };
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(); });
        }
        return Promise.resolve(legacy());
    }

    function init(root) {
        var toggle = root.querySelector('.sdock__toggle');
        if (!toggle) { return; }
        var links = root.querySelectorAll('.sdock__story, .sdock__list a'); // ordem do teclado
        var url = pageUrl();
        var title = pageTitle();
        var story = null; // {blob, comFoto} — arte dos Stories pré-gerada

        // Links do compartilhamento padrão + subtítulo com o título da matéria
        each(root.querySelectorAll('.sdock__list a'), function (a) {
            var b = builders[a.getAttribute('data-share')];
            if (b) { a.href = b(url, title); }
        });
        var sub = root.querySelector('.sdock__sub');
        if (sub) { sub.textContent = title; sub.title = title; }

        // Ordem da cascata de entrada
        each(root.querySelectorAll('.sdock__head, .sdock__label, .sdock__stories, .sdock__list li, .sdock__foot'), function (el, i) {
            el.style.setProperty('--i', i);
        });

        var isOpen = function () { return hasClass(root, 'is-open'); };
        var set = function (open) {
            if (open) { addClass(root, 'is-open'); } else { removeClass(root, 'is-open'); }
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggle.setAttribute('aria-label', open ? 'Fechar compartilhamento' : 'Compartilhar matéria');
        };

        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            set(!isOpen());
            if (isOpen()) {
                setTimeout(warmStory, 600); // garante a arte pronta antes do toque
                if (e.detail === 0 && links[0]) { setTimeout(function () { links[0].focus(); }, 180); }
            }
        });

        document.addEventListener('keydown', function (e) {
            if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) { set(false); toggle.focus(); }
        });

        root.addEventListener('keydown', function (e) {
            var idx = Array.prototype.indexOf.call(links, document.activeElement);
            if (idx < 0) { return; }
            var next = { ArrowDown: idx + 1, ArrowRight: idx + 1, ArrowUp: idx - 1, ArrowLeft: idx - 1, Home: 0, End: links.length - 1 }[e.key];
            if (next === undefined) { return; }
            e.preventDefault();
            links[(next + links.length) % links.length].focus();
        });

        root.addEventListener('focusout', function (e) {
            if (isOpen() && e.relatedTarget && !root.contains(e.relatedTarget)) { set(false); }
        });

        document.addEventListener('click', function (e) {
            if (!isOpen() || e.defaultPrevented) { return; }
            var t = e.target;
            if (!root.contains(t) || hasClass(t, 'sdock__scrim') || closest(t, '.sdock__list a')) { set(false); }
        });

        /* ---------------- Stories: publicação direta ----------------
           Um toque na bolinha abre na hora o menu de compartilhamento do aparelho
           com a arte 1080x1920 já anexada (Web Share API nível 2). No Android ele
           traz atalhos diretos ("Instagram Stories", "Seu story", "Status"); no iOS
           o app abre com a imagem e a opção de Story. Sem janela, sem tutorial.
           O navegador só abre o menu logo após o toque, então a arte é pré-gerada
           e o share é chamado de forma síncrona dentro do clique. */
        function canShareFiles() {
            if (!navigator.canShare || !navigator.share || !window.File) { return false; }
            try { return navigator.canShare({ files: [new File([''], 't.jpg', { type: 'image/jpeg' })] }); } catch (e) { return false; }
        }

        function warmStory() {
            return Story.prepare().then(function (res) { story = res; return res; }, function () { return null; });
        }

        // Retorno curto no texto pequeno da bolinha (visual do cartão não muda)
        function flash(btn, msg, ms) {
            var small = btn.querySelector('small');
            if (!small) { return; }
            if (!small.getAttribute('data-orig')) { small.setAttribute('data-orig', small.textContent); }
            clearTimeout(btn._flashTimer);
            small.textContent = msg;
            if (ms) {
                btn._flashTimer = setTimeout(function () { small.textContent = small.getAttribute('data-orig'); }, ms);
            }
        }

        function saveImage(btn) {
            download(story.blob);
            flash(btn, 'Imagem salva', 2600);
        }

        function shareNow(btn) {
            copyText(url); // link pronto para a figurinha "Link" ou a legenda (não consome o gesto)
            if (!canShareFiles()) { saveImage(btn); return; } // computador: Stories só pelo celular
            flash(btn, 'Abrindo…');
            // Só o arquivo: Instagram/Facebook recusam ou descartam quando vem texto junto
            navigator.share({ files: [fileFrom(story.blob)] }).then(function () {
                flash(btn, 'Enviado', 1800);
                set(false);
            }, function (err) {
                var nome = err && err.name;
                if (nome === 'AbortError') { flash(btn, btn.querySelector('small').getAttribute('data-orig'), 0); return; } // cancelou
                if (nome === 'NotAllowedError') { flash(btn, 'Toque de novo', 4000); return; } // gesto expirou
                saveImage(btn);
            });
        }

        each(root.querySelectorAll('.sdock__story'), function (btn) {
            btn.setAttribute('aria-describedby', 'sdockStoriesLbl');
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                if (hasClass(btn, 'is-busy')) { return; }
                if (story) { shareNow(btn); return; } // caminho normal: arte já pronta, dentro do gesto
                addClass(btn, 'is-busy');
                flash(btn, 'Preparando…');
                warmStory().then(function (res) {
                    removeClass(btn, 'is-busy');
                    if (!res) { flash(btn, 'Tente de novo', 3000); return; }
                    shareNow(btn); // se o navegador considerar o gesto expirado, cai em "Toque de novo"
                });
            });
        });

        // Pré-gera a arte com a página ociosa, para o primeiro toque já abrir direto
        var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
        idle(function () { warmStory(); });

        /* ---------------- Copiar link ---------------- */
        var copy = root.querySelector('[data-action="copy"]');
        if (copy) {
            var label = copy.querySelector('span');
            var original = label.textContent;
            copy.addEventListener('click', function () {
                copyText(url).then(function (ok) {
                    if (!ok) { window.prompt('Copie o link da matéria:', url); return; } // último recurso
                    label.textContent = 'Link copiado!';
                    setTimeout(function () { label.textContent = original; }, 2000);
                });
            });
        }

        /* ---------------- Menu nativo (compartilhamento padrão do aparelho) ---------------- */
        var native = root.querySelector('[data-action="native"]');
        if (native && navigator.share && isMobile()) {
            native.hidden = false;
            native.addEventListener('click', function () {
                navigator.share({ title: title, text: title, url: url }).then(null, function () {});
            });
        }
    }

    each(document.querySelectorAll('.sdock'), init);
})();
