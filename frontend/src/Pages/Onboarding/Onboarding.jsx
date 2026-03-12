import Logo from '../../assets/EDITH.svg?react';
import styles from './Onboarding.module.css';
import QuestionOption from '../../components/QuestionOption/QuestionOption.jsx';
import Button from '../../components/Button/Button.jsx';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

const Onboarding = () => {
    const navigate = useNavigate();
    const handleNext = () => {
        const googleServices = ["Gmail", "Google Calendar"];
        const tools = selected
            .map(s => googleServices.includes(s) ? "Google" : s)
            .filter((s, i, arr) => arr.indexOf(s) === i);
        navigate("/connectionPage", {state: {selectedTools: tools}})
    }
    const labels = [
        {
            id : 1,
            label : "Jira",
        },
        {
            id : 2,
            label : "GitHub",
        },
        {
            id : 3,
            label : "Slack",
        },
        {
            id : 4,
            label : "Gmail",
        },
        {
            id : 5,
            label : "Google Calendar",
        },
    ];
    const [selected, setSelected] = useState([]);
        const handleToggle = (label) => {
            console.log(label);
            console.log(selected);
            if(selected.includes(label)) {
                setSelected(selected.filter((item) => item !== label))
            }
            else if(selected.length < 2){
                setSelected([...selected, label])
            }
            else{
                return
            }
        };
    return (
        <section className = {styles.mainSection}>
            <div className={styles.container}>
                <Logo className={styles.logo} />
                <div className={styles.questionContainer}>
                    <p className = {styles.question}>What are the 2 main tools that you’d like to set up first ?</p>
                    <div className={styles.optionContainer}>
                        {labels.map((label) => (
                            <QuestionOption checked={selected.includes(label.label)} disabled= {!selected.includes(label.label)&& selected.length >= 2} onChange = {() => {handleToggle(label.label)}} key = {label.id} label={label.label} />
                        ))}
                    </div>
                </div>
                <Button disabled={selected.length < 2} label="Next" onClick={handleNext} />
            </div>
        </section>
    );
}

export default Onboarding; 