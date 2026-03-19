import { createContext, useContext, useState } from 'react';

const NavBarContext = createContext();

export const NavBarProvider = ({ children }) => {
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <NavBarContext.Provider value={{ expanded, setExpanded, mobileOpen, setMobileOpen }}>
      {children}
    </NavBarContext.Provider>
  );
};

export const useNavBar = () => useContext(NavBarContext);
