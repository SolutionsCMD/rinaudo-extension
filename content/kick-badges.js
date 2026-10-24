(function () {
  'use strict';
  if (self.__rgcKickBadges) return;
  self.__rgcKickBadges = true;

  const SEL = {
    room: '#channel-chatroom',
    row: '[data-index]',
    name: 'button.inline.font-bold[data-prevent-expand]',
    badges: 'div.flex.items-center.gap-1.self-center',
    bot: '[data-testid="identity-badge-bot"]',
  };
  const BADGE_BOX_CLASS = 'flex items-center gap-1 self-center pr-1';
  const MARK = 'rgcRank';
  const CLS = 'rgc-rank-badge';
  const ASK_MS = 5 * 60 * 1000;
  const WATCH_MS = 3000;
  const BROKEN_AFTER_MS = 60 * 1000;

  const IMG = {
    top10: 'data:image/webp;base64,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',
    top100: 'data:image/webp;base64,UklGRroGAABXRUJQVlA4WAoAAAAQAAAAIwAAIwAAQUxQSOUCAAABkC3btmk7Y861z7X1FF8bsW3btm3btu3kKrZt27Z5MB/OvXuf5AsiYgLwPyuAFOkhRYAyQADDMAOkD8384dk8DpwRI6aFF/waQydpKGArGHLrTy49webbwQWt+aFRRgBNl5pXpB0YmTLay5VaMoOQqVsiVv6tMb4MDJYeW/vPasS72SmUf+Fb6k/yppNT3Sgzcp91Yu3WP2W8n5WDAjQMkvrBW+/8PldL6dHqnPt7KyW4jgyDBph4uHX0jMnBJWG4eI5JM8dax7MJIBSSMwNvyBxl0kUmniPX+p2RoiBgSGUM/Syy2pNIF4g814p8HISKQ4GUn1nKra1S0Q8EgwS/ilXXlc3yMw2YLTMGp/Z/WhZshFH+Wf/kYbNkLqi8vBu6RC6aCIbJ6bIsHflBKjMwwvxOLoUSG2MKvyxvzSOBaFfUP96y7CwXONB5dsU2p+vDJSb5crmsN3s8vMuO4FvPet7OUvpici35PazPVpkHZUxhlqT1G/xTamkp8m3D52+VY5mNMMdV/vJty3dJ1chv/ls5E7sunUxGTJS2OfaMvF3gTwS4jtzcxnIbIH0E3DS3Sh7lAhDCEn2Cziy1XCpbCooyI4USZc5bFp8J8k0MAybL+/kjJ8mM8e/9Ac6IAd+3E6fIpFELPsh4kEeqiEXuhq6XnmEBYDtGYHgn2Rh8z2YRSXUjAlol7165d/0x24KZV4JBACH46tTZtqPr9qzek9waIBDsm6Z1tM5oIdf8iYj8rkqz6daOKY1hTwBI0yJ79l560NymyS/pyZpG3eRn49bmw0t69Y4xaQQAjOZWEZETp/f3+zUfAOb/7rPz5Amxbw62A7zqrDm/uzkXmLXp05kkT4+4k182zirETXedW1fHE3qdAM9+B+Vzn/WPHm7s80kODfACnKBbMTjmnsivuthRu9YO1Polcj+WwUoPoNB0T8rsvPAuBhTxQd456fuaQcGxDDADDEcTkWKAAQZYEZEj/ikAVlA4IK4DAAAwEwCdASokACQAPikSh0KhoQnOAtoMAUJZQDHjSJ8D3AecD1AbYDxZvWW0wDyAPTP9iv9yPR1u9r6P0CHnA++3fmR/17vZf3PjA+nfmH7+D1IP6R/nfR2/1fIv85f8n++/AF/H/5v/q/zW7x3od/qIKI5IytsGsOQJqcT18eYLRDf7nTygFIydavEmKuRLqbdacxKiK5qcMDAei8Xp3Drm/sAA/v4xO6k9EtxXwCu/iPO3rl/FDmtwcMFvFW7Xhi1Y2Sy1D746nc/rqLSNvscuF6qX47eSlzlKo8geUA9nM1HI94jq9UD9mc3aQeqfaTHK1bul7WMpqTK6ja6FNBTouqm9LRzqye0kqH/4UBY6raGN9FKcx4KTkWw3MSsdi6bO8JzsdBUyoklP9iBnSEJofpMQ7fP4SnL6l5aePBiS2o/9oaId0NVUgQ5WTe89+WAWc/0mPWe+qwyj/PhDtwodXwjJ1b8rbJhb5v6wnbu4fS6VC6/4u8z3DvXvuSWhPJ9bmLVbrhXECCZXgQzXPZ/JDoY/ZguvRnOBVR6zGLFbQOsAA9toXe+je61H0EL1rAtZuXDuNgmd0prOP5t8HXWvC3OiNU4gnvsEuWlaPCDANJXHTjM0zz+QXg+nfl8Pcn7Vi7+cFHsTrl175Qj5LcU5vsO5sNDSPtTqoiz8D73aXVC4TrH05myAvPFSMCQ1oTl0UOfvLNp8qfeHg4pgcaiUjcJwfW9QDwrMTF2DN/pU+1ZdCX+pwPS7tqOTcXGB9s44V/5B8NPftJmNw+jBcIqGXBg3eBa7AjWoYEZVzE9UeWXAAXOw0DHI5tfKI5T/iX38vnTiKRgpYPb4B+8SfL9u7Qh72P47fCuHAMteFNNOX+VOBFfoUL2VG6ev+vozp35WFoNk18EiYtt5uSHJ3dAkpvylA7jLTcyN0Gv12+PECGRTKU1mfRzvWv9c+tQqU2ZXGth1pWr7hjElomdPlW0kz1gAxyqAbzUKXKAHpZGh/DNbr+UHogOPeFl8MObvc5O5biCA/GyxuTp1ul0vMPV2G6XFikE41PgkSg/4XbaaGe/GYRAqESszoLJNw+pzyQ3X/i/IaVaWZ1Z9SQn2hD8ZbiIDniT0ycWUaTy8UAIemwhPeD66t5/SnzmWn1ROA4Su3ntcXYREMjFquSkc+J0N7e22TWnzqEZWvxs9Iz+FdWLf4mJnZ8weXJ8n8+4I//UW+SYF71nECERdrU1d0Guo/bL6Reb3tP/+bLwAAAA=',
    top500: 'data:image/webp;base64,UklGRsIFAABXRUJQVlA4WAoAAAAQAAAAIwAAIwAAQUxQSMUBAAABkHPbtqqne9rnnos7bazF3d2dLqlw/1IyqBnpcXeXNulwp0qPu9Olwu99Zxcvue97g4iYAPyPIiNHiZSlOHseWpKg3/fv/SDleKwiV8OX4+QWeRuuFIexwSxMgCtDsYcx8CC0BMHAzzTjt8GQ6inWMyMzboRWTZzct0hGPhAnSU7V51WdYnwwkrQ4EepUfV5VkCo4wpiLPA5B6pSmxg2VHS17T1xqvfbwBy1n/PX4euul47t2bq9saGyaOO0tS38zGbXt/BNCCDHGzLqyLMYYQgh/2F4LxcA2RmO1I9sGQuGgRxitOhZ5VOEAOEELLatGZmyBOORFse0fs2IZQwUq6FKxvINWxNixEopUj/GvzdLM3kyAR3o3zC/EReiGguo2M6ZFVpwvhIsMaYFX4Yqg+zNmaRlf94SkOYz8x04tyyxHxnFwaR6bGHOBJGMushk+TXGGgYzG780bv9AiGXgBmobuT2gWyTMNQO1JMprxWQ9IisOQvxbIx3MA9cDsR2RgGJnmsS6L/NzsoAKIQiqfGbNN8CmK4/x3uAai6FQFtUcjT0ETBL3eP5gOeCR6YMbjj70gKfWbABUki0K2NKR0qiis6BoAVlA4INYDAAAQFgCdASokACQAPikQhkKhoQuNAmYMAUJbACDCxCeU/jByyW5HcPJp+ebBV9gG2A8wH6T/rt7xX9V/YD3Aecl1DXoAfrH6YfsUfuj+yvs9//a6b/hf1aPkn2cyer5jOK/4DJTfnv980YvjBu9PNl/t/6J69Gaz5e/3f5gfQL/G/5n/mPty5Az9gCOQMeuwdVAbej3DkYOLrDlid/erZjolTSX4LE8JgWhrHKPXhLGYZcCdLy12zE98mAD+//6DtPP2iX+kNeyz0zdxin991B+x1WBtHRt4lkGO3N+X8dDcWgwe+OQEgicyEqnGep8AhqXLZpvv338hVyVc0SzXsFcv8+sJWr+6K5E7sKGcupxGZt4pYw8DZHzbhw7mqoVlv5sLczeGK4iDV/MoKyfzYD/H8BTdh9WRSeoScB2STmK8XK66zOYz7aDUVn7LdrRzM4Mc9Scjd7+BRPTU/8ccSAO9kn2ZP1UkjJlcvlrL8rWhnPvFtN/ycESv5c5WjnxNdi9cY/zQ9woD25qQTzXAuNZnaqyBc6wVcA+lmwO79Q1it/zjIBOH4SQ6IiBtYsygpVwRz7hfJewUDx3p6iVqtiNJiULkzfNUdDIRJzS0Rz2KXXyvapiGua+aRb8COjxCpfdMBGCfPJ62cm5z6RqyhWfxjgqxs/1Wirf7cR/MhGpTlbO/i19fOU19j7OO5TjI3IsI87A8bo1GKrvJ0B9yqP0TPzpXbPp43NSx5C+NQDPjr1TyIJOMAiL0g/o1u8sHGtf42+b+RUnkqzm8HC8fM7qJslxe4TuPAe2NWG9oDWhzMp771IwuyKyJp56XHB/WOrcZU8ZmXwVtyZsKvMa25W2c92vGurFdwb9GldkX893lu1/rqpqX78G32DdnfQEErDf13VNLDXSfUV9ny/7gvtxuMxEc+FvUuKnpXuwqIGnlHyXm8GLteHD9veVkCLpthesDrrUDlf8RepOFgQ8BBG3SVS20KTtGuv/t16ihsFR4dFRa41t+HZIOY5GO4TEQI5XssP8ul2M0iBigLPELlzyHIu4qsxNPj7Ee4R6fzoCl8tJn/y3To3s3X8r7YtH5W7M86ohF+y7n9D0ah8UOf2/WGqhBcKxhkGdiR0LO12aQ1Mzmt7GLtuZgeEoAyllTXW90TnQJCvJrK3w39n7/TDBMWS8+Ys5ffXeZ0xLSNBwPGGWgfUckyDPSbd1aDYCubelJP/+xviKRe3K7QoLN0rWXRu/wtQf5fOQ1nPkHmeXuU5WiV21x1H7no43da/ZifNbClKVAUaNN5lr5MP/zrk1cuI8AAAAA',
    top1000: 'data:image/webp;base64,UklGRoAFAABXRUJQVlA4WAoAAAAQAAAAIwAAIwAAQUxQSCkCAAABkHRrmyHJ8t/IHNu2bdu2bextc2fbs7Zt27bNqs6IeM/pzIzIiQgFkiQze3Jm8AgAEMiQEXBhMRfInQMCIXNQ885gAeGY5DhwBj9uB9ek4uSZVoArghIu0PwM2dKsMv8UubsKkEQEU5V3kp5uZVGcUtNbXgBI4k8yP0atNC0qGaemJN+PzwCkHPGKlKRVxf8lKrCge33aXSc9zURpS3GJuPRFLUkyuAZ6bGuSQIEfVIq+KaXDC6CqCwcmV+GAYdkMb+RoDQijz5YOnW6YEtoj7/dE6qxmvvUf9QRGvCODxeSnCQ66P+lgblKOPF4PmRfFqZVSTFiVA3UOkS0s7GKK3F4U5Xb4wa6KKLSFlKqVbSAfxc95qdDiyrXWSD7rB7XUtEvTI58PB4CBT0gvAt9iAb5akldaNr9Aykh8i4f5qgC2iHzz/aQMYdVahempGha+1Q5F4XuitpEvkAroetOY8MinAyHSAkZ2V9oBY9+b+H6blQJtb7cxNylC7q2ObMs9Kp8vN+VHxb3Wd1T0r6ZalxeV9/rB4drIsiTBzrdIjB75eXJStL56uyMw6gNp51s8xPdRb0Cg2/VAyq5YmO/pBtUPR+VbNGbhq6Lxzf/XwJeUBno1zXydekcN5HQ4dba5ELBY3/ukRyPfoS5s3hHIOO2b6V3/nJ0VcGG1JEDxTYH7JsltZYAkiGLCBRoe9oMTjULfW7SEA3R/+KhP4Gv8D3MFsmaFsE0CAFZQOCAwAwAAEBAAnQEqJAAkAD4pEIZCIaELjQOYDAFCWgAguKUibuS/8/E4DBOf2A9wG8AegB+pPWWftt6Rf//umfLA/6kAvFnNIZ31fnZ/y3pif4HlB+gP+X/bvgC/j38z/ynAk/q0RAItKohLaLymesNTV/NtZAGj1WeNgKiqwbf5z09kw++gLDr78aDdgQAA/dFGfibDpnP+tf/ptVx4G+uuiO6utaAAIHS9OYkBDlZUH9EDH2KVjOvF3GwKArugLQL/16uDj2/zT061ikfIFvG+Eiinz4EJjyUyo3o4d/QYryeW9Ak3md+JWEGU1uFI37Fa63ARDgMUrcsO3BjyeP/73WNyC///sext5hgy6NP/Tf67ZV/e3wcXmB9q5ZQRRhpmLdE3dBymmsj1PMtpZpAQl/7Dk7HekqzO7U10pb21ljn8/w3qZR4IR2+Ij9aid4LU5vnG80Ml6fw+bi6pAa+sP/l1tueCAm3tph1Cwf1/3YjPirLgziDMOOoDhn5kJgAHPo56RDWAf8Cqixkzn5LD4c78EWNEN0YTkC7rQ4HHL/G/zrbHVPQR3VHN+J39Yr/puI+g/WmgSUrI6Xg5pMR2ZoChP/fR5F1f3v+Ip7/A+qPf9NkoGC8pLDUT7ZQ3kxN21a76TkefHFLMgRYqnXRz4UMf8C0jydbRBjmwwAURgxJHq26mbHBtp+9bTcZV/HuG7dXupaLOAUzKcK/XBi+8XTZZUs495d7xNWEWezY2v4qvAN/d8mqPH2GpbHynfJJ7jBM2Z4ZW9GnvutDA2thj9q2B7Ebfi47FDO5Jix4IupWw9CxC6Air16+ncuYZEqZFi+96uCU4v6/9mkac5u9uWu8YMUhbCp0Wu6PQVLuX9OhuaHd22kTHaRZCY0DTrV/YHceVfFRlVauyaSc3iP2K1bd4bv++yyo+WQxf+zfdKUUv/V+DLWROZPRBR4pKN2mlv59y9FQJDOTjkJ6FNyoKAlw7X2wtZTc/aP1vfO1lVr+DYq5V6Mbtax60eHsDmmqakDZh58+P+tZhClbSv125asd601Va+o6mROxxP8oOtdcrG9grryLnnx9aRe6ByTlyAAAA',
    member: 'data:image/webp;base64,UklGRlQDAABXRUJQVlA4WAoAAAAQAAAAIwAAIwAAQUxQSIAAAAABcBzZthJdNCfIAIIgKYjGZSymr7jd5awiQkHbNkzPhqABAXhw0rzsu/7SXV/mqQMPW+NRT7etxxgePGRistrctLaTyOAhkpOeHlhPMkL42/osvzCxZnpoY5Ni+09fUU3Pz1QNDA09Q/1/TJyNcLbG2Sxn+xyGUFhEYhqHjRTGAlZQOCCuAgAAcA4AnQEqJAAkAD4pEohCIaEhFV1UrBgChLKAX0CgrE8gfwF8HcYDYbYC7QPQA6XOYgfffxEyer1j8ks+/vTu270A7wGlc5QH0Z/rvVN/zHAcmDskHmZXNMisc77pM9uMj+QHDg9qqWMQYgPvF9qjOOgTBWty3spj52rpQAD+//5QHjuWo9yaqcNY6rkIl5RjVbUoQiB5DQjHkBYY9nW5Z9mvXe7OBhq2/Q/bRuWvZrf+f/28HYwBfBfz+ovVPxMf5t9QrjewNZrQwXB4rLls5uoH0iPh1hZoWV0AN/X9bT31i2P1nL7tXLoPR8xbX5ZtiFF5RnOzP/S/EB//a/WvaLCgP/6334fSGE/QCuH/4SpV8Nfvsv/RWTRdiQ48neIf3yfGKDm8fJqPWe/CYAHGBVB2davrnrl2K2+cgWl7h+9Dbt1fD7Qm56jMngrPND/KVGgw49mPMuuM3G/afMiwZdbg1/FF9w38/8Hg7oUl5ATPDfw/wseLQXR2gFqU72733XD/k5MoCM0AUyF4mVo+aYuWeM+ds+HTa//8zQe7NlabMjRH9f+vX/ujcdGlHC4PJAIUEK/srIPN3Xe+MjC2Gw/6/HmFGF5oJLi9cBr0FBU9bgG1CZhIph7GD/J1xiKmTLrDn4moHUhsiy7JJDrj7Uo9YV6zqwxMyid5XVO8D6F+kdujwkR+O+9ugJe6a013/XakT+npME1TYjTcaDp7m4UjBRdPEBao+P1YhviYPDp530/bTqUCH2WfMK5sFRfsc7NM/mQt8eAjwY3QnVDWLCAa7BYkyOKZ1dCmg+JNXjVWp5gBvuczOtySEWudiDJ03fa3xvw09AGcgcvLYQwW7t43dlQm5EAH5l9ESDKD5B8FYhk3Hs8zH995bn/g4wTdwnUlcnQZyiCRbcMsAAA=',
    'place-1': 'data:image/webp;base64,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',
    'place-2': 'data:image/webp;base64,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',
    'place-3': 'data:image/webp;base64,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',
    'place-4': 'data:image/webp;base64,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',
    'place-5': 'data:image/webp;base64,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',
  };
  const KEYS = ['top10', 'top100', 'top500', 'top1000'];

  let ranks = null, tiers = [[1, 10], [11, 100], [101, 500], [501, 1000]];
  let on = true, room = null, mo = null, dead = false, rowsSince = 0;
  let askT = 0, watchT = 0;

  const fmt = (n) => Number(n).toLocaleString('en-US');

  function tierIndex(rank) {
    for (let i = 0; i < tiers.length && i < KEYS.length; i++) {
      const [lo, hi] = tiers[i];
      if (rank >= lo && rank <= hi) return i;
    }
    return -1;
  }
  function badgeFor(rank) {
    const i = tierIndex(rank);
    const key = i < 0 ? 'member' : KEYS[i];
    const label = i < 0 ? 'Member' : 'Top ' + fmt(tiers[i][1]);
    return { src: IMG[key], title: 'Mizkif Global ' + label + ', #' + fmt(rank) };
  }

  const BADGE_PX = 36;
  const FONT_FAMILY = 'RGC Badge DM Sans';
  const FONT_FILE = 'fonts/dm-sans-latin.woff2';
  const FALLBACK_FONT = 'sans-serif';
  const FONT_WAIT_MS = 1500;
  const OUTLINE = '#0B1015';
  const MEASURE_PX = 200;
  const DM_SANS_800 = { wide: [0, 0.641, 1.347, 2.053], ascent: 0.719, descent: 0.016 };
  const CREST_KEYS = ['place-1', 'place-2', 'place-3', 'place-4', 'place-5', 'top10', 'top100', 'top500', 'top1000'];

  function badgeSpec(place) {
    const p = Number(place);
    if (!Number.isInteger(p) || p < 1) return { crest: 'member', number: null };
    if (p <= 5) return { crest: 'place-' + p, number: String(p) };
    if (p <= 10) return { crest: 'top10', number: String(p) };
    if (p <= 99) return { crest: 'top100', number: String(p) };
    if (p <= 499) return { crest: 'top500', number: String(p) };
    if (p <= 999) return { crest: 'top1000', number: String(p) };
    if (p === 1000) return { crest: 'top1000', number: null };
    return { crest: 'member', number: null };
  }

  function numberLayout(digits, size, metrics) {
    const m = metrics || DM_SANS_800;
    const n = Math.max(1, Math.min(3, Math.floor(digits) || 1));
    const maxWidth = size * 0.98;
    const px = Math.min((size * 0.62) / (m.ascent + m.descent), maxWidth / m.wide[n]);
    const side = size * 0.55;
    return {
      px,
      baseline: size - (size * 4) / 144 - m.descent * px,
      maxWidth,
      stroke: Math.max((1.5 * size) / 36, (7 * size) / 144),
      crest: { x: (size - side) / 2, y: (-6 * size) / 144, w: side, h: side },
    };
  }

  function ink(ctx, text) {
    const t = ctx.measureText(text);
    if (typeof t.actualBoundingBoxLeft === 'number' && typeof t.actualBoundingBoxRight === 'number') {
      return { left: t.actualBoundingBoxLeft, right: t.actualBoundingBoxRight, width: t.actualBoundingBoxLeft + t.actualBoundingBoxRight, t };
    }
    return { left: 0, right: t.width, width: t.width, t };
  }

  function measureDigits(ctx, family) {
    ctx.font = '800 ' + MEASURE_PX + 'px ' + family;
    const wide = [0, 0, 0, 0];
    let ascent = 0, descent = 0;
    for (let n = 1; n <= 3; n++) {
      const count = Math.pow(10, n);
      for (let i = 0; i < count; i++) {
        const s = String(i).padStart(n, '0');
        const k = ink(ctx, s);
        if (k.width > wide[n]) wide[n] = k.width;
        if (n === 1) {
          if (typeof k.t.actualBoundingBoxAscent === 'number') ascent = Math.max(ascent, k.t.actualBoundingBoxAscent);
          if (typeof k.t.actualBoundingBoxDescent === 'number') descent = Math.max(descent, k.t.actualBoundingBoxDescent);
        }
      }
    }
    const out = { wide: wide.map((w) => w / MEASURE_PX), ascent: ascent / MEASURE_PX, descent: descent / MEASURE_PX };
    if (!(out.wide[3] > 0)) throw new Error('measureText gave nothing');
    if (!(out.ascent > 0)) { out.ascent = DM_SANS_800.ascent; out.descent = DM_SANS_800.descent; }
    return out;
  }

  let crests = null;
  let fontOk = false;
  let canvas = null;
  const metricsByFont = new Map();
  const drawn = new Map();
  let drawnKey = '';

  function assetKey() { return (crests ? 'c' : '') + (fontOk ? 'f' : ''); }

  function drawBadge(spec) {
    const crest = crests && crests[spec.crest];
    if (!crest) throw new Error('crest not ready');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = BADGE_PX;
      canvas.height = BADGE_PX;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const family = fontOk ? '"' + FONT_FAMILY + '"' : FALLBACK_FONT;
    let m = metricsByFont.get(family);
    if (!m) { m = measureDigits(ctx, family); metricsByFont.set(family, m); }
    const L = numberLayout(spec.number.length, BADGE_PX, m);
    ctx.clearRect(0, 0, BADGE_PX, BADGE_PX);
    ctx.imageSmoothingEnabled = true;
    try { ctx.imageSmoothingQuality = 'high'; } catch (_) {   }
    ctx.drawImage(crest, L.crest.x, L.crest.y, L.crest.w, L.crest.h);
    ctx.font = '800 ' + MEASURE_PX + 'px ' + family;
    const k = ink(ctx, spec.number);
    const scale = L.px / MEASURE_PX;
    const x = (BADGE_PX - k.width * scale) / 2 + k.left * scale;
    ctx.font = '800 ' + L.px.toFixed(2) + 'px ' + family;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = L.stroke * 2;
    ctx.strokeStyle = OUTLINE;
    ctx.strokeText(spec.number, x, L.baseline);
    ctx.fillStyle = '#fff';
    ctx.fillText(spec.number, x, L.baseline);
    const url = canvas.toDataURL('image/png');
    if (!/^data:image\/png;base64,/.test(url)) throw new Error('canvas export refused');
    return url;
  }

  function srcFor(rank) {
    const spec = badgeSpec(rank);
    if (!spec.number) return badgeFor(rank).src;
    const key = assetKey();
    if (key !== drawnKey) { drawn.clear(); drawnKey = key; }
    let src = drawn.get(rank);
    if (src) return src;
    try { src = drawBadge(spec); } catch (_) { src = badgeFor(rank).src; }
    drawn.set(rank, src);
    return src;
  }

  function redraw() {
    if (dead || assetKey() === drawnKey) return;
    try {
      document.querySelectorAll('img.' + CLS + '[data-rgc-place]').forEach((img) => {
        const src = srcFor(Number(img.dataset.rgcPlace));
        if (img.src !== src) img.src = src;
      });
    } catch (_) {   }
  }

  function loadCrests() {
    return new Promise((resolve) => {
      try {
        if (typeof Image !== 'function') return resolve(false);
        const out = {};
        Promise.all(CREST_KEYS.map((key) => {
          const im = new Image();
          im.src = IMG[key];
          out[key] = im;
          return im.decode ? im.decode() : new Promise((ok, no) => { im.onload = ok; im.onerror = no; });
        })).then(() => { crests = out; resolve(true); }, () => resolve(false));
      } catch (_) { resolve(false); }
    });
  }

  function loadFont() {
    return new Promise((resolve) => {
      try {
        if (typeof FontFace !== 'function' || !document.fonts || typeof fetch !== 'function'
          || !chrome.runtime || typeof chrome.runtime.getURL !== 'function') return resolve(false);
        fetch(chrome.runtime.getURL(FONT_FILE))
          .then((r) => { if (!r.ok) throw new Error('font ' + r.status); return r.arrayBuffer(); })
          .then((buf) => new FontFace(FONT_FAMILY, buf, { weight: '100 1000' }).load())
          .then((face) => { document.fonts.add(face); fontOk = true; resolve(true); })
          .catch(() => resolve(false));
      } catch (_) { resolve(false); }
    });
  }

  function decorate(btn) {
    if (!btn || !btn.dataset || btn.dataset[MARK]) return;
    btn.dataset[MARK] = '1';
    if (!ranks) return;
    const name = String(btn.textContent || '').trim().replace(/^@/, '').toLowerCase();
    const rank = name && ranks[name];
    if (!rank) return;
    let box = btn.previousElementSibling;
    if (box && box.querySelector && box.querySelector(SEL.bot)) return;
    if (!box || !box.matches || !box.matches(SEL.badges)) {
      box = document.createElement('div');
      box.className = BADGE_BOX_CLASS;
      btn.parentNode.insertBefore(box, btn);
      box.dataset[MARK] = 'box';
    }
    const b = badgeFor(rank);
    const img = document.createElement('img');
    img.className = CLS;
    img.src = srcFor(rank);
    if (badgeSpec(rank).number) img.dataset.rgcPlace = String(rank);
    img.alt = '';
    img.title = b.title;
    img.setAttribute('aria-label', b.title);
    img.draggable = false;
    img.style.cssText = 'width:calc(1em*(18/13));height:calc(1em*(18/13));display:inline-block;flex-shrink:0;object-fit:contain';
    box.appendChild(img);
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(SEL.name)) { decorate(root); return; }
    const found = root.querySelectorAll(SEL.name);
    for (let i = 0; i < found.length; i++) decorate(found[i]);
  }

  function clearAll() {
    document.querySelectorAll('.' + CLS).forEach((n) => n.remove());
    document.querySelectorAll('[data-rgc-rank="box"]').forEach((n) => { if (!n.children.length) n.remove(); });
    document.querySelectorAll('[data-rgc-rank]').forEach((n) => { delete n.dataset[MARK]; });
  }

  function stopObserving() { if (mo) { try { mo.disconnect(); } catch (_) {   } mo = null; } room = null; }

  function attach() {
    if (dead || !on) return;
    const r = document.querySelector(SEL.room);
    if (r === room && mo) return;
    stopObserving();
    if (!r) return;
    room = r;
    mo = new MutationObserver((records) => {
      try {
        for (const rec of records) for (const n of rec.addedNodes) if (n.nodeType === 1) scan(n);
      } catch (e) { teardown(); }
    });
    mo.observe(r, { childList: true, subtree: true });
    scan(r);
  }

  function health() {
    if (!room || !on) { rowsSince = 0; return; }
    const rows = room.querySelectorAll(SEL.row).length;
    const names = room.querySelectorAll(SEL.name).length;
    if (rows > 3 && names === 0) {
      if (!rowsSince) rowsSince = Date.now();
      else if (Date.now() - rowsSince > BROKEN_AFTER_MS) {
        try { chrome.runtime.sendMessage({ type: 's2Debug', kind: 'kickbadge', data: { rows, names, path: location.pathname } }); } catch (_) {   }
        teardown();
      }
    } else rowsSince = 0;
  }

  function ask() {
    try { chrome.runtime.sendMessage({ type: 'kickRanks' }, () => { void chrome.runtime.lastError; }); } catch (_) {   }
  }

  function apply(store) {
    if ('kickBadges' in store) on = store.kickBadges !== false;
    if (store.kickRanks && store.kickRanks.ranks) {
      ranks = store.kickRanks.ranks;
      if (Array.isArray(store.kickRanks.tiers) && store.kickRanks.tiers.length) tiers = store.kickRanks.tiers;
    }
  }

  function refreshAll() {
    clearAll();
    if (on) { stopObserving(); attach(); } else stopObserving();
  }

  function teardown() {
    dead = true;
    clearInterval(askT); clearInterval(watchT);
    stopObserving();
    try { clearAll(); } catch (_) {   }
    try { chrome.storage.onChanged.removeListener(onStore); } catch (_) {   }
  }

  function onStore(changes, area) {
    if (area !== 'local' || dead) return;
    const s = {};
    if (changes.kickBadges) s.kickBadges = changes.kickBadges.newValue;
    if (changes.kickRanks) s.kickRanks = changes.kickRanks.newValue;
    if (!Object.keys(s).length) return;
    apply(s);
    if (changes.kickBadges && changes.kickBadges.newValue !== false) ask();
    refreshAll();
  }

  let crestsP = Promise.resolve(false), fontP = Promise.resolve(false);
  try {
    crestsP = loadCrests();
    fontP = loadFont();
    let started = false;
    crestsP.then(() => { if (started) redraw(); });
    fontP.then(() => { if (started) redraw(); });
    const ready = Promise.race([Promise.all([crestsP, fontP]), new Promise((r) => setTimeout(r, FONT_WAIT_MS))]);
    chrome.storage.local.get(['kickRanks', 'kickBadges'], (s) => {
      if (dead) return;
      apply(s || {});
      ready.then(() => {
        if (dead) return;
        started = true;
        try { attach(); } catch (e) { teardown(); }
      });
    });
    chrome.storage.onChanged.addListener(onStore);
    ask();
    askT = setInterval(() => { if (on && !document.hidden) ask(); }, ASK_MS);
    watchT = setInterval(() => { try { attach(); health(); } catch (e) { teardown(); } }, WATCH_MS);
  } catch (e) {
    teardown();
  }

  self.__rgcKickBadgesTest = {
    tierIndex, badgeFor, decorate, scan, clearAll, teardown, SEL,
    badgeSpec, numberLayout, measureDigits, srcFor, drawBadge, redraw, DM_SANS_800, BADGE_PX, IMG,
    ready: () => Promise.all([crestsP, fontP]),
  };
})();
