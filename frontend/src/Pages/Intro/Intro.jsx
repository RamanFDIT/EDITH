import { useNavigate } from 'react-router-dom';
import Button from '../../components/Button/Button.jsx'
import styles from './Intro.module.css';

const Intro = () => {
    const navigate = useNavigate();

    return (
        <section className = {styles.mainSection}>
            <div className = {styles.container}>
                <h1 className = {styles.header}>E.D.I.T.H.</h1>
                <p className = {styles.description}>Engineered as an intelligent AI agent, EDITH automates complex project management tasks across Jira, GitHub, Slack, and Google Calendar. It streamlines developer workflows, transforming fragmented toolchains into a unified system.</p>
                <Button label = "Next" onClick={() => navigate('/onboarding')} />
            </div>
        </section>
    );
};

export default Intro;