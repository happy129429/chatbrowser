;(self.rspackChunkchatbrowser = self.rspackChunkchatbrowser || []).push([
  [1690],
  {
    3153() {
      var e, r
      ;(((e = Prism).languages.diff = {
        coord: [/^(?:\*{3}|-{3}|\+{3}).*$/m, /^@@.*@@$/m, /^\d.*$/m],
      }),
        Object.keys(
          (r = {
            'deleted-sign': '-',
            'deleted-arrow': '<',
            'inserted-sign': '+',
            'inserted-arrow': '>',
            unchanged: ' ',
            diff: '!',
          })
        ).forEach(function (s) {
          var a = r[s],
            n = []
          ;(/^\w+$/.test(s) || n.push(/\w+/.exec(s)[0]),
            'diff' === s && n.push('bold'),
            (e.languages.diff[s] = {
              pattern: RegExp('^(?:[' + a + '].*(?:\r\n?|\n|(?![\\s\\S])))+', 'm'),
              alias: n,
              inside: {
                line: { pattern: /(.)(?=[\s\S]).*(?:\r\n?|\n)?/, lookbehind: !0 },
                prefix: { pattern: /[\s\S]/, alias: /\w+/.exec(s)[0] },
              },
            }))
        }),
        Object.defineProperty(e.languages.diff, 'PREFIXES', { value: r }))
    },
  },
])
