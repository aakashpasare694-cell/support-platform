import { useCallback, useEffect, useState } from 'react'

export const DESIGNS = [
  {
    id: 'studio',
    name: 'Studio',
    tagline: 'Balanced default',
    description: 'Indigo on cool neutrals, soft cards, medium density. The safe, familiar SaaS register.',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    tagline: 'Dense engineering tool',
    description: 'Near-monochrome zinc with violet reserved for state. Hairline borders instead of shadows, 6px corners, tight rows.',
  },
  {
    id: 'atlas',
    name: 'Atlas',
    tagline: 'Warm and roomy',
    description: 'Paper-toned surfaces and deep teal, 16px corners, soft warm shadows and generous spacing. Easier on the eye over long reading.',
  },
  {
    id: 'contrast',
    name: 'Contrast',
    tagline: 'Maximum legibility',
    description: 'Strong borders carry the structure, no shadows, 4px corners and the tightest rows. Built for bright rooms and long shifts.',
  },
] as const

export type DesignId = (typeof DESIGNS)[number]['id']

const KEY = 'sp.design'

function initial(): DesignId {
  if (typeof document === 'undefined') return 'studio'
  const attr = document.documentElement.getAttribute('data-design')
  return (DESIGNS.find((d) => d.id === attr)?.id ?? 'studio') as DesignId
}

export function useDesign() {
  const [design, setDesign] = useState<DesignId>(initial)

  useEffect(() => {
    document.documentElement.setAttribute('data-design', design)
    try {
      localStorage.setItem(KEY, design)
    } catch {
      // Blocked storage just means the choice does not persist.
    }
  }, [design])

  const select = useCallback((id: DesignId) => setDesign(id), [])
  return { design, select, designs: DESIGNS }
}
