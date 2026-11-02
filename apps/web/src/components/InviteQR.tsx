import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { inviteMessage, joinUrl } from '../lib/invite'
import { btnPrimary, btnSecondary } from '../lib/ui'

const QR_COLORS = { dark: '#1E2A24', light: '#FFFFFF' } // carbón verde sobre blanco

// QR de invitación de la iglesia: para imprimir y pegar en el templo, o
// compartir por WhatsApp. El código CHBK-XXXX también sirve escrito a mano.
export default function InviteQR({ code, churchName }: { code: string; churchName: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    QRCode.toString(joinUrl(code), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: QR_COLORS }).then(setSvg)
  }, [code])

  const download = async () => {
    const url = await QRCode.toDataURL(joinUrl(code), { width: 1200, margin: 2, errorCorrectionLevel: 'M', color: QR_COLORS })
    const a = document.createElement('a')
    a.href = url
    a.download = `ChBook-${code}.png`
    a.click()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Sin permiso de portapapeles: el código queda seleccionable a mano.
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
      <div className="w-48 shrink-0 rounded-2xl border border-clay-light bg-white p-3" role="img" aria-label={`Código QR para unirse a ${churchName}`}>
        {svg ? <div className="[&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="aspect-square animate-pulse rounded-lg bg-cream" />}
      </div>
      <div className="min-w-0 flex-1 text-center sm:text-left">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-graysage">Código de la iglesia</p>
        <p className="mt-1 select-all font-mono text-4xl tracking-wider text-charcoal">{code}</p>
        <p className="mt-2 text-sm text-graysage">Quien escanee el QR o escriba el código entra como prospecto hasta que lo apruebes.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
          <button type="button" onClick={download} className={btnPrimary}>Descargar QR</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(inviteMessage(churchName, code))}`} target="_blank" rel="noreferrer" className={btnSecondary}>
            Compartir por WhatsApp
          </a>
          <button type="button" onClick={copy} className={btnSecondary}>{copied ? 'Copiado ✓' : 'Copiar código'}</button>
        </div>
      </div>
    </div>
  )
}
