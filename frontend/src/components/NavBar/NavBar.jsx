import { NavLink } from 'react-router-dom';
import styles from "./NavBar.module.css";
import Logo from '../../assets/EDITH.svg?react';
import settings from '../../assets/settings.svg';
import hamburger from '../../assets/hamburger.svg';
import profile from '../../assets/profile.svg';
import { useState } from 'react';

const NavBar = () => {
  const[toggle, setToggle] = useState(true);
  const handleClick = () => {
    setToggle(!toggle);
  };

  return (
    <nav className={toggle ? styles.navBar : styles.navBarCompact}>
      <div className = {toggle ? styles.logoContainer : styles.logoContainerCompact}>
        <Logo className = {toggle ? styles.logo : styles.displayNone} alt = "EDITH Logo">
        </Logo>
        <img onClick = {handleClick} src = {hamburger} className = {styles.hamburger} alt = "arrow"></img>
      </div>
      <div className = {styles.activeToolContainer}>
        <div></div>
        <div className = {styles.settingContainer}>
          <NavLink
          className = {toggle ? styles.profile : styles.profileCompact}
          to = "/settings">
            <img src = {settings} className = {styles.settings} alt = "settings"></img>
            <p className = {!toggle && styles.displayNone }>Settings</p>
          </NavLink>
          <NavLink 
          to = "/profile"
          className= {toggle ? styles.profile : styles.profileCompact}>
            <img src = {profile} className = {styles.settings} alt = "Profile"></img>
            <p className = {!toggle && styles.displayNone }>Profile</p>
          </NavLink>
       </div>
      </div>
    </nav>
  );
};

export default NavBar;