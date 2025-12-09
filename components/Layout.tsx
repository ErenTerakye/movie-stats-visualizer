import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-lb-bg text-lb-text flex flex-col items-center p-4 md:p-8">
      <div className="w-full max-w-6xl">
        {children}
      </div>
    </div>
  );
};

export default Layout;