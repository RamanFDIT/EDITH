import { createContext, useContext, useState } from 'react';

const NavBarContext = createContext();

export const NavBarProvider = ({ children }) => {
  const [expanded, setExpanded] = useState(true);
  return (
    <NavBarContext.Provider value={{ expanded, setExpanded }}>
      {children}
    </NavBarContext.Provider>
  );
};

export const useNavBar = () => useContext(NavBarContext);
