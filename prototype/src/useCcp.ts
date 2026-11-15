import { useCallback, useEffect, useRef, useState } from 'react';
import { createCcpController, initialCcpState } from './ccp';
import type { CcpAction, CcpSource, CcpState } from './ccp';

export function useCcp({ onBack }: { onBack?: () => void } = {}) {
  const [state, setState] = useState<CcpState>(initialCcpState);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const controller = useRef<ReturnType<typeof createCcpController> | null>(null);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-ccp-root]');
    if (!root) return;
    controller.current = createCcpController(root, { onBack: () => onBackRef.current?.(), onChange: setState });
    return () => { controller.current?.destroy(); controller.current = null; };
  }, []);
  const dispatch = useCallback((action: CcpAction, source: CcpSource = 'simulator') => controller.current?.dispatch(action, source), []);
  return { ...state, dispatch };
}
