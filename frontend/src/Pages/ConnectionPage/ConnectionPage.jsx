import Button from '../../components/Button/Button.jsx';
import ConnectionCard from '../../components/ConnectionCard/ConnectionCard.jsx';
import { useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import styles from './ConnectionPage.module.css'

const ConnectionPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const selectedTools = location.state ?.selectedTools || [];
    const [connected, setConnected] = useState([]);
    const cardInfo = [
        {
            id : 1,
            cardHead : "Google",
            oauth : "google"
        },
        {
            id : 2,
            cardHead : "GitHub",
            oauth : "github"
        },
        {
            id : 3,
            cardHead : "Jira",
            oauth : "jira"
        },
        {
            id : 4,
            cardHead : "Slack",
            oauth : "slack"
        },
        {
            id : 5,
            cardHead : "Gmail",
            oauth : "google"
        },
        {
            id : 6,
            cardHead : "Google Calendar",
            oauth : "google"
        },
    ];
    const toolsToShow = cardInfo.filter(card => 
        card.cardHead === "Google" || selectedTools.includes(card.cardHead)
    );
    const handleConnection = async (providerKey) => {
        if (!providerKey) {
            console.error(`No OAuth provider mapped for "${providerKey}"`);
            return;
        };

        if (!window.electronAPI) {
            console.error("Not running in Electron — OAuth unavailable");
            return;
        };

        const result = await window.electronAPI.oauthConnect(providerKey);

        if (result.success) {
            console.log(`Successfully connected to "${providerKey}"`);
            setConnected(prev => [...prev, providerKey])
        }else {
            console.error(`Failed to connect to "${providerKey}"`)
        };
    };
    const allConnected = toolsToShow.every(card => connected.includes(card.oauth))
    return (
        <section className = {styles.mainSection}>
            <div className={styles.container}>
                {toolsToShow.map((info) => (
                    <ConnectionCard onConnect={() => handleConnection(info.oauth)} cardHead = {info.cardHead} key = {info.id} />
                ))}
                <Button disabled = {!allConnected} onClick={() => navigate('/home')} label = "Next"/>
            </div>
        </section>
    );
};

export default ConnectionPage;