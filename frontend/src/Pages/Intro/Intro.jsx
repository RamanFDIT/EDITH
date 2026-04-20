import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Button from '../../components/Button/Button.jsx'
import styles from './Intro.module.css';
import { ease, durations } from '../../lib/motion.js';

const heroStagger = {
    animate: { transition: { staggerChildren: 0.12, delayChildren: 0.08 } },
};
const heroItem = {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0, transition: { duration: durations.slow, ease } },
};

const Intro = () => {
    const navigate = useNavigate();

    return (
        <section className={styles.mainSection}>
            <motion.div
                className={styles.container}
                variants={heroStagger}
                initial="initial"
                animate="animate"
            >
                <motion.h1 className={styles.header} variants={heroItem}>E.D.I.T.H.</motion.h1>
                <motion.p className={styles.description} variants={heroItem}>Engineered as an intelligent AI agent, EDITH automates complex project management tasks across Jira, GitHub, Slack, and Google Calendar. It streamlines developer workflows, transforming fragmented toolchains into a unified system.</motion.p>
                <motion.div variants={heroItem}>
                    <Button
                        label="Get Started"
                        onClick={() => navigate('/auth')}
                    />
                </motion.div>
            </motion.div>
        </section>
    );
};

export default Intro;
