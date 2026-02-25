'use client';

import { APP_NAME } from '../../lib/authCopy';

export default function AuthFooter() {
  return (
    <footer
      className="auth-footer"
      role="contentinfo"
    >
      © {new Date().getFullYear()} {APP_NAME}
    </footer>
  );
}
